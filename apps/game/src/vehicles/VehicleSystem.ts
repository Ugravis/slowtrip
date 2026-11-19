import * as THREE from 'three'
import type { Physics } from '../physics/physics'
import type { TerrainSystem } from '../world/terrain/TerrainSystem'
import { Vehicle, type DriveControls } from './Vehicle'
import { buildVehicleGeometry, buildWheelGeometry } from './vehicleGeometry'
import type { VehicleSpec } from './vehicleSpecs'

const MAX_VEHICLES = 4

// Scratch objects (no allocations per frame).
const _m = new THREE.Matrix4()
const _local = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _qSpin = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _Y = new THREE.Vector3(0, 1, 0)
const _X = new THREE.Vector3(1, 0, 0)
const _cp = { x: 0, y: 0, z: 0 }

export interface VehicleEntity {
  vehicle: Vehicle
  /** Rendered with the interpolated pose; read it for cameras. */
  mesh: THREE.Mesh
  /** Pose before the last physics step (for interpolation). */
  prevPos: THREE.Vector3
  prevRot: THREE.Quaternion
}

/** Owns vehicles: physics, chassis meshes (1 draw call each) and all wheels (1 instanced draw call). */
export class VehicleSystem {
  readonly group = new THREE.Group()
  readonly entities: VehicleEntity[] = []
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true })
  private readonly wheelGeometry = buildWheelGeometry()
  private readonly wheels: THREE.InstancedMesh

  constructor(
    private readonly physics: Physics,
    private readonly terrain: TerrainSystem,
  ) {
    this.group.name = 'vehicles'
    this.wheels = new THREE.InstancedMesh(this.wheelGeometry, this.material, MAX_VEHICLES * 4)
    this.wheels.count = 0
    this.wheels.frustumCulled = false
    this.group.add(this.wheels)
  }

  add(spec: VehicleSpec, x: number, y: number, z: number, yaw: number): VehicleEntity {
    if (this.entities.length >= MAX_VEHICLES) throw new Error('Too many vehicles')
    const vehicle = new Vehicle(this.physics, spec, x, y, z, yaw)
    vehicle.body.setEnabled(false) // until the ground collider exists
    const mesh = new THREE.Mesh(buildVehicleGeometry(spec), this.material)
    mesh.matrixAutoUpdate = false
    mesh.name = spec.id
    this.group.add(mesh)
    const entity: VehicleEntity = {
      vehicle,
      mesh,
      prevPos: new THREE.Vector3(x, y, z),
      prevRot: new THREE.Quaternion(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)),
    }
    this.entities.push(entity)
    this.wheels.count = this.entities.length * 4
    return entity
  }

  entityOf(vehicle: Vehicle): VehicleEntity | null {
    for (const entity of this.entities) if (entity.vehicle === vehicle) return entity
    return null
  }

  /** Freezes vehicles standing on chunks without a collider; wakes them when ground is ready. */
  updateEnabled(): void {
    for (const { vehicle } of this.entities) {
      const t = vehicle.body.translation()
      const ground = this.terrain.hasColliderAt(t.x, t.z)
      if (ground !== vehicle.body.isEnabled()) vehicle.body.setEnabled(ground)
    }
  }

  /** Physics pre-step: only `driven` receives controls, others stay parked. */
  step(dt: number, driven: Vehicle | null, controls: DriveControls): void {
    for (const { vehicle, prevPos, prevRot } of this.entities) {
      const t = vehicle.body.translation()
      const r = vehicle.body.rotation()
      prevPos.set(t.x, t.y, t.z)
      prevRot.set(r.x, r.y, r.z, r.w)
      vehicle.step(dt, vehicle === driven ? controls : null)
    }
  }

  /** Snaps interpolation to the current pose (after teleports and origin shifts). */
  resetInterpolation(): void {
    for (const { vehicle, prevPos, prevRot } of this.entities) {
      const t = vehicle.body.translation()
      const r = vehicle.body.rotation()
      prevPos.set(t.x, t.y, t.z)
      prevRot.set(r.x, r.y, r.z, r.w)
    }
  }

  /**
   * Copies physics transforms to meshes and wheel instances, interpolated between the
   * last two physics steps by `alpha` (smooth motion on high refresh rate displays).
   */
  sync(alpha: number): void {
    for (let v = 0; v < this.entities.length; v++) {
      const { vehicle, mesh, prevPos, prevRot } = this.entities[v] as VehicleEntity
      const t = vehicle.body.translation()
      const r = vehicle.body.rotation()
      _p.set(t.x, t.y, t.z)
      mesh.position.copy(prevPos).lerp(_p, alpha)
      _q.set(r.x, r.y, r.z, r.w)
      mesh.quaternion.copy(prevRot).slerp(_q, alpha)
      mesh.updateMatrix()

      const c = vehicle.controller
      const spec = vehicle.spec
      for (let i = 0; i < 4; i++) {
        const cp = c.wheelChassisConnectionPointCs(i, _cp)
        if (!cp) continue
        const susp = c.wheelSuspensionLength(i) ?? spec.suspensionRest
        _p.set(cp.x, cp.y - susp, cp.z)
        _q.setFromAxisAngle(_Y, c.wheelSteering(i) ?? 0)
        _qSpin.setFromAxisAngle(_X, -(c.wheelRotation(i) ?? 0))
        _q.multiply(_qSpin)
        _s.set(spec.wheelWidth, spec.wheelRadius, spec.wheelRadius)
        _local.compose(_p, _q, _s)
        _m.multiplyMatrices(mesh.matrix, _local)
        this.wheels.setMatrixAt(v * 4 + i, _m)
      }
    }
    this.wheels.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    for (const { vehicle, mesh } of this.entities) {
      vehicle.dispose()
      mesh.geometry.dispose()
    }
    this.entities.length = 0
    this.wheelGeometry.dispose()
    this.wheels.dispose()
    this.material.dispose()
  }
}
