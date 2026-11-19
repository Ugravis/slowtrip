import * as THREE from 'three'
import type { Vehicle } from '../vehicles/Vehicle'

const _target = new THREE.Vector3()
const _desired = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _q = new THREE.Quaternion()

/** Drives the render camera from the player state. */
export class CameraRig {
  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly groundAt: (x: number, z: number) => number,
  ) {}

  /** Third-person chase camera behind the vehicle, following its heading. */
  followVehicle(vehicle: Vehicle, dt: number): void {
    const t = vehicle.body.translation()
    const r = vehicle.body.rotation()
    const spec = vehicle.spec
    _q.set(r.x, r.y, r.z, r.w)
    _fwd.set(0, 0, -1).applyQuaternion(_q)
    _fwd.y = 0
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1)
    _fwd.normalize()

    _target.set(t.x, t.y + 1.2, t.z)
    _desired.copy(_target).addScaledVector(_fwd, -spec.chaseDistance)
    _desired.y += spec.chaseHeight
    const minY = this.groundAt(_desired.x, _desired.z) + 1
    if (_desired.y < minY) _desired.y = minY

    this.camera.position.lerp(_desired, 1 - Math.exp(-dt * 5))
    this.camera.lookAt(_target)
  }

  /** Moves the camera with the floating origin. */
  shift(dx: number, dz: number): void {
    this.camera.position.x -= dx
    this.camera.position.z -= dz
  }
}
