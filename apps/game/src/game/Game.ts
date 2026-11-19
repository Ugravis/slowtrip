import type * as THREE from 'three'
import { CameraRig } from '../camera/CameraRig'
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

/** Owns every simulation system. Plain TS: React only mounts `scene` objects and calls `update`. */
export class Game {
  readonly physics: Physics
  readonly origin = new WorldOrigin()
  readonly terrain: TerrainSystem
  readonly vehicles: VehicleSystem
  readonly input = new Input()
  readonly cameraRig: CameraRig
  /** Main-thread copy of the height function (spawn, camera clamping). Same seed as the worker. */
  readonly height: HeightSampler
  /** Vehicle currently driven by the player, if any. */
  driven: Vehicle | null = null

  private readonly controls: DriveControls = { throttle: 0, steer: 0, handbrake: false }
  private readonly stepVehicles = (dt: number) => this.vehicles.step(dt, this.driven, this.controls)

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

    const spawn = findFlatSpot(this.height)
    const { x, z } = spawn
    const van = this.vehicles.add(VAN, x - 2.5, this.heightAtLocal(x - 2.5, z) + 2, z, 0)
    this.vehicles.add(OFFROAD, x + 2.5, this.heightAtLocal(x + 2.5, z) + 2, z, 0)
    this.driven = van.vehicle
    camera.position.set(x, this.heightAtLocal(x, z + 10) + 5, z + 10)
  }

  /** Height of the terrain at a local position. */
  heightAtLocal(lx: number, lz: number): number {
    return this.height(lx + this.origin.x, lz + this.origin.z)
  }

  /** Speed of the driven vehicle in km/h (0 on foot). */
  get speedKmh(): number {
    return this.driven ? Math.abs(this.driven.speed) * 3.6 : 0
  }

  update(dt: number): void {
    const input = this.input
    input.poll()
    const driven = this.driven

    if (driven) {
      this.controls.throttle = input.move.y
      this.controls.steer = input.move.x
      this.controls.handbrake = input.brake
      if (input.consume('reset')) {
        const t = driven.body.translation()
        driven.resetUpright(this.heightAtLocal(t.x, t.z))
      }
    }

    this.vehicles.updateEnabled()
    this.physics.update(dt, this.stepVehicles)
    this.vehicles.sync()

    if (driven) this.cameraRig.followVehicle(driven, dt)

    const focus = driven?.body.translation()
    if (focus) {
      this.terrain.update(focus.x, focus.z)
      const shift = this.origin.rebaseFor(focus.x, focus.z)
      if (shift) {
        this.origin.apply(shift.dx, shift.dz)
        this.physics.shift(shift.dx, shift.dz)
        this.terrain.onOriginShift()
        this.cameraRig.shift(shift.dx, shift.dz)
      }
    }
  }

  dispose(): void {
    this.input.dispose()
    this.vehicles.dispose()
    this.terrain.dispose()
    this.physics.dispose()
  }
}
