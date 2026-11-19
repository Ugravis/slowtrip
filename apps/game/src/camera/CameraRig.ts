import * as THREE from 'three'
import { Character } from '../character/Character'
import type { VehicleSpec } from '../vehicles/vehicleSpecs'

export type CameraView = 'first' | 'third'

/** Radians per pixel of look input. */
const LOOK_SENSITIVITY = 0.0022
/** Seconds without look input before the free look recenters. */
const RECENTER_DELAY = 1.6
const BASE_FOV = 65
const SPEED_FOV = 10

const _target = new THREE.Vector3()
const _desired = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _eye = new THREE.Vector3()
const _euler = new THREE.Euler(0, 0, 0, 'YXZ')
const _qLook = new THREE.Quaternion()
const _pos = { x: 0, y: 0, z: 0 }

/** Exponential damping factor, frame-rate independent. */
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt)

function wrapAngle(a: number): number {
  return a - Math.round(a / (Math.PI * 2)) * Math.PI * 2
}

/**
 * Drives the render camera.
 * - Vehicle: third person (orbit around a chase point) or first person (driver seat with free look).
 * - On foot: first person only.
 */
export class CameraRig {
  view: CameraView = 'third'
  /** Base vertical FOV in degrees (settings). Speed and first-person offsets add to it. */
  baseFov = BASE_FOV
  private heading = Number.NaN
  private orbitYaw = 0
  private orbitPitch = 0
  private lookYaw = 0
  private lookPitch = 0
  private idle = 0
  private fov = BASE_FOV

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly groundAt: (x: number, z: number) => number,
  ) {}

  toggleView(): CameraView {
    this.view = this.view === 'third' ? 'first' : 'third'
    this.reset()
    return this.view
  }

  /** Snaps smoothing state (after entering/exiting a vehicle or switching view). */
  reset(): void {
    this.heading = Number.NaN
    this.orbitYaw = 0
    this.orbitPitch = 0
    this.lookYaw = 0
    this.lookPitch = 0
    this.idle = 0
  }

  /**
   * Vehicle camera. `mesh` holds the interpolated chassis pose.
   * `lookX/lookY` are pixel deltas from mouse or touch.
   */
  vehicle(
    mesh: THREE.Object3D,
    spec: VehicleSpec,
    speed: number,
    lookX: number,
    lookY: number,
    dt: number,
  ): void {
    const looking = lookX !== 0 || lookY !== 0
    this.idle = looking ? 0 : this.idle + dt
    const recenter = this.idle > RECENTER_DELAY ? damp(2.5, dt) : 0

    if (this.view === 'first') {
      this.lookYaw = clamp(this.lookYaw - lookX * LOOK_SENSITIVITY, -2.2, 2.2)
      this.lookPitch = clamp(this.lookPitch - lookY * LOOK_SENSITIVITY, -1.35, 0.8)
      this.lookYaw -= this.lookYaw * recenter
      this.lookPitch -= this.lookPitch * recenter

      _eye.set(spec.driverEye[0], spec.driverEye[1], spec.driverEye[2]).applyMatrix4(mesh.matrix)
      this.camera.position.copy(_eye)
      _euler.set(this.lookPitch, this.lookYaw, 0)
      _qLook.setFromEuler(_euler)
      this.camera.quaternion.copy(mesh.quaternion).multiply(_qLook)
      this.setFov(this.baseFov + 5, dt)
      return
    }

    // Third person: smoothed heading + user orbit offset.
    _fwd.set(0, 0, -1).applyQuaternion(mesh.quaternion)
    const flat = Math.hypot(_fwd.x, _fwd.z)
    const heading = flat > 1e-3 ? Math.atan2(-_fwd.x, -_fwd.z) : this.heading || 0
    if (Number.isNaN(this.heading)) this.heading = heading
    // Follow the heading lazily: faster at speed so the camera stays behind.
    const followRate = 2 + Math.min(4, Math.abs(speed) * 0.2)
    this.heading += wrapAngle(heading - this.heading) * damp(followRate, dt)

    this.orbitYaw = wrapAngle(this.orbitYaw - lookX * LOOK_SENSITIVITY)
    // Total pitch = base chase angle + orbit: from slightly below the roof line to near top-down.
    this.orbitPitch = clamp(this.orbitPitch + lookY * LOOK_SENSITIVITY, -0.6, 1.2)
    this.orbitYaw -= this.orbitYaw * recenter
    this.orbitPitch -= this.orbitPitch * recenter

    const yaw = this.heading + this.orbitYaw
    const pitch = Math.atan2(spec.chaseHeight, spec.chaseDistance) + this.orbitPitch
    const dist = Math.hypot(spec.chaseDistance, spec.chaseHeight)

    _target.copy(mesh.position)
    _target.y += 1.3
    _desired.set(
      _target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      _target.y + Math.sin(pitch) * dist,
      _target.z + Math.cos(yaw) * Math.cos(pitch) * dist,
    )
    // Keep the camera (and the midpoint of its sight line) above the terrain.
    const minY = this.groundAt(_desired.x, _desired.z) + 0.8
    if (_desired.y < minY) _desired.y = minY
    const midX = (_desired.x + _target.x) / 2
    const midZ = (_desired.z + _target.z) / 2
    const midMin = this.groundAt(midX, midZ) + 0.5
    const midY = (_desired.y + _target.y) / 2
    if (midY < midMin) _desired.y += (midMin - midY) * 2

    this.camera.position.copy(_desired)
    this.camera.lookAt(_target)
    this.setFov(this.baseFov + Math.min(1, Math.abs(speed) / 30) * SPEED_FOV, dt)
  }

  /** First-person view from the character's eyes (the only on-foot view). */
  character(character: Character, alpha: number, dt: number): void {
    character.renderPosition(alpha, _pos)
    this.camera.position.set(_pos.x, _pos.y + Character.EYE_OFFSET, _pos.z)
    _euler.set(character.pitch, character.yaw, 0)
    this.camera.quaternion.setFromEuler(_euler)
    this.setFov(this.baseFov + 5, dt)
  }

  /** Moves the camera with the floating origin. */
  shift(dx: number, dz: number): void {
    this.camera.position.x -= dx
    this.camera.position.z -= dz
  }

  private setFov(target: number, dt: number): void {
    this.fov += (target - this.fov) * damp(3, dt)
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov
      this.camera.updateProjectionMatrix()
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
