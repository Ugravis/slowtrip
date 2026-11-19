import * as THREE from 'three'
import { CameraRig } from '../camera/CameraRig'
import { Character, type WalkControls } from '../character/Character'
import { Input } from '../core/input'
import type { QualitySettings } from '../core/quality'
import { Physics, type Rapier } from '../physics/physics'
import type { DriveControls, Vehicle } from '../vehicles/Vehicle'
import { OFFROAD, VAN } from '../vehicles/vehicleSpecs'
import { VehicleSystem } from '../vehicles/VehicleSystem'
import { WorldOrigin } from '../world/origin'
import { createHeightSampler, type HeightSampler } from '../world/terrain/heightSampler'
import { findFlatSpot } from '../world/terrain/spawn'
import { TerrainSystem } from '../world/terrain/TerrainSystem'
import { useGameStore } from './store'

/** Max distance (m) from a vehicle's side to get in. */
const ENTER_MARGIN = 1.6
/** Max speed (m/s) to get out of a vehicle. */
const EXIT_MAX_SPEED = 3
const MOUSE_SENSITIVITY = 0.0022

const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()

/** Owns every simulation system. Plain TS: React only mounts `scene` objects and calls `update`. */
export class Game {
  readonly physics: Physics
  readonly origin = new WorldOrigin()
  readonly terrain: TerrainSystem
  readonly vehicles: VehicleSystem
  readonly character: Character
  readonly input = new Input()
  readonly cameraRig: CameraRig
  /** Main-thread copy of the height function (spawn, camera clamping). Same seed as the worker. */
  readonly height: HeightSampler
  /** Vehicle currently driven by the player; null when on foot. */
  driven: Vehicle | null = null
  /** Vehicle close enough to get in (on foot only). */
  private nearby: Vehicle | null = null

  private readonly drive: DriveControls = { throttle: 0, steer: 0, handbrake: false }
  private readonly walk: WalkControls = { x: 0, y: 0, sprint: false, jump: false }
  private readonly prePhysics = (dt: number) => {
    this.vehicles.step(dt, this.driven, this.drive)
    if (!this.driven && this.character.body.isEnabled()) {
      this.character.step(dt, this.walk)
      this.walk.jump = false
    }
  }

  constructor(
    rapier: Rapier,
    readonly seed: number,
    quality: QualitySettings,
    camera: THREE.PerspectiveCamera,
  ) {
    this.physics = new Physics(rapier)
    this.height = createHeightSampler(seed)
    this.terrain = new TerrainSystem(seed, quality.viewRadius, this.physics, this.origin)
    this.vehicles = new VehicleSystem(this.physics, this.terrain)
    this.cameraRig = new CameraRig(camera, (x, z) => this.heightAtLocal(x, z))

    const { x, z } = findFlatSpot(this.height)
    this.vehicles.add(VAN, x - 2.5, this.heightAtLocal(x - 2.5, z) + 2, z, 0)
    this.vehicles.add(OFFROAD, x + 2.5, this.heightAtLocal(x + 2.5, z) + 2, z, 0)
    // Start on foot, behind the two parked vehicles.
    this.character = new Character(this.physics, x, this.heightAtLocal(x, z + 8) + 0.5, z + 8)
    this.character.setActive(false)
    useGameStore.getState().setMode('onFoot')
  }

  /** Height of the terrain at a local position. */
  heightAtLocal(lx: number, lz: number): number {
    return this.height(lx + this.origin.x, lz + this.origin.z)
  }

  /** Speed of the driven vehicle in km/h (0 on foot). */
  get speedKmh(): number {
    return this.driven ? Math.abs(this.driven.speed) * 3.6 : 0
  }

  /** Contextual action hint for the HUD, or null. */
  get hint(): string | null {
    if (this.driven) {
      return Math.abs(this.driven.speed) > EXIT_MAX_SPEED
        ? null
        : `E · Get out of the ${this.driven.spec.name}`
    }
    return this.nearby ? `E · Drive the ${this.nearby.spec.name}` : null
  }

  update(dt: number): void {
    const input = this.input
    input.poll()

    if (this.driven) this.updateDriving(this.driven)
    else this.updateOnFoot()

    this.vehicles.updateEnabled()
    const c = this.character.body.translation()
    if (!this.driven) {
      const ground = this.terrain.hasColliderAt(c.x, c.z)
      if (ground !== this.character.body.isEnabled()) this.character.setActive(ground)
    }

    this.physics.update(dt, this.prePhysics)
    this.vehicles.sync()

    if (this.driven) this.cameraRig.followVehicle(this.driven, dt)
    else this.cameraRig.firstPersonCharacter(this.character)

    const focus = this.driven ? this.driven.body.translation() : this.character.body.translation()
    this.terrain.update(focus.x, focus.z)
    const shift = this.origin.rebaseFor(focus.x, focus.z)
    if (shift) {
      this.origin.apply(shift.dx, shift.dz)
      this.physics.shift(shift.dx, shift.dz)
      this.terrain.onOriginShift()
      this.cameraRig.shift(shift.dx, shift.dz)
    }

    input.endFrame()
  }

  private updateOnFoot(): void {
    const input = this.input
    this.character.look(-input.look.x * MOUSE_SENSITIVITY, -input.look.y * MOUSE_SENSITIVITY)
    this.walk.x = input.move.x
    this.walk.y = input.move.y
    this.walk.sprint = input.sprint
    if (input.consume('jump')) this.walk.jump = true

    this.nearby = this.findNearbyVehicle()
    if (this.nearby && input.consume('interact')) this.enter(this.nearby)
  }

  private updateDriving(vehicle: Vehicle): void {
    const input = this.input
    this.drive.throttle = input.move.y
    this.drive.steer = input.move.x
    this.drive.handbrake = input.brake
    if (input.consume('reset')) {
      const t = vehicle.body.translation()
      vehicle.resetUpright(this.heightAtLocal(t.x, t.z))
    }
    if (input.consume('interact') && Math.abs(vehicle.speed) <= EXIT_MAX_SPEED) this.exit(vehicle)
  }

  private findNearbyVehicle(): Vehicle | null {
    const c = this.character.body.translation()
    let best: Vehicle | null = null
    let bestDist = Infinity
    for (const { vehicle } of this.vehicles.entities) {
      const t = vehicle.body.translation()
      const d = Math.hypot(t.x - c.x, t.z - c.z)
      const reach = vehicle.spec.halfExtents[2] + ENTER_MARGIN
      if (d < reach && d < bestDist) {
        best = vehicle
        bestDist = d
      }
    }
    return best
  }

  private enter(vehicle: Vehicle): void {
    this.driven = vehicle
    this.nearby = null
    this.character.setActive(false)
    vehicle.body.wakeUp()
    useGameStore.getState().setMode('driving')
  }

  private exit(vehicle: Vehicle): void {
    // Step out on the driver's side (left), next to the door.
    const spec = vehicle.spec
    const r = vehicle.body.rotation()
    const t = vehicle.body.translation()
    _q.set(r.x, r.y, r.z, r.w)
    _v.set(-(spec.halfExtents[0] + 0.8), 0, spec.driverEye[2]).applyQuaternion(_q)
    const x = t.x + _v.x
    const z = t.z + _v.z
    _v.set(0, 0, -1).applyQuaternion(_q)
    const yaw = Math.atan2(-_v.x, -_v.z)
    this.character.placeAt(x, this.heightAtLocal(x, z), z, yaw)
    this.character.setActive(true)
    this.driven = null
    useGameStore.getState().setMode('onFoot')
  }

  dispose(): void {
    this.input.dispose()
    this.character.dispose()
    this.vehicles.dispose()
    this.terrain.dispose()
    this.physics.dispose()
  }
}
