import type * as THREE from 'three'
import type { QualitySettings } from '../core/quality'
import { Physics, type Rapier } from '../physics/physics'
import { WorldOrigin } from '../world/origin'
import { createHeightSampler, type HeightSampler } from '../world/terrain/heightSampler'
import { TerrainSystem } from '../world/terrain/TerrainSystem'

/** Owns every simulation system. Plain TS: React only mounts `scene` objects and calls `update`. */
export class Game {
  readonly physics: Physics
  readonly origin = new WorldOrigin()
  readonly terrain: TerrainSystem
  /** Main-thread copy of the height function (spawn, camera clamping). Same seed as the worker. */
  readonly height: HeightSampler

  constructor(
    rapier: Rapier,
    readonly seed: number,
    quality: QualitySettings,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.physics = new Physics(rapier)
    this.height = createHeightSampler(seed)
    this.terrain = new TerrainSystem(seed, quality.viewRadius, this.physics, this.origin)
  }

  /** Height of the terrain at a local position. */
  heightAtLocal(lx: number, lz: number): number {
    return this.height(lx + this.origin.x, lz + this.origin.z)
  }

  update(dt: number): void {
    // Placeholder flyover until vehicles exist (#5).
    const cam = this.camera
    cam.position.z -= 12 * dt
    const ground = this.heightAtLocal(cam.position.x, cam.position.z)
    cam.position.y += (ground + 25 - cam.position.y) * Math.min(1, dt * 2)
    cam.rotation.set(-0.25, 0, 0)

    this.physics.update(dt, () => {})
    this.terrain.update(cam.position.x, cam.position.z)

    const shift = this.origin.rebaseFor(cam.position.x, cam.position.z)
    if (shift) {
      this.origin.apply(shift.dx, shift.dz)
      this.physics.shift(shift.dx, shift.dz)
      this.terrain.onOriginShift()
      cam.position.x -= shift.dx
      cam.position.z -= shift.dz
    }
  }

  dispose(): void {
    this.terrain.dispose()
    this.physics.dispose()
  }
}
