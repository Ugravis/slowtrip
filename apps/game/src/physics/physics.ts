import type RAPIER from '@dimforge/rapier3d-compat'

export type Rapier = typeof RAPIER

export const PHYSICS_DT = 1 / 60
const MAX_SUBSTEPS = 4

let ready: Promise<Rapier> | null = null

/** Loads the Rapier WASM module once, in its own lazy chunk. */
export function loadRapier(): Promise<Rapier> {
  ready ??= import('@dimforge/rapier3d-compat').then(async ({ default: rapier }) => {
    await rapier.init()
    return rapier
  })
  return ready
}

/** Fixed-timestep physics world. */
export class Physics {
  readonly world: RAPIER.World
  private accumulator = 0

  constructor(readonly rapier: Rapier) {
    this.world = new rapier.World({ x: 0, y: -9.81, z: 0 })
    this.world.timestep = PHYSICS_DT
  }

  /**
   * Advances the simulation by `dt` seconds of real time.
   * `beforeStep` runs before each fixed step (controllers, forces).
   * Returns the interpolation alpha in [0, 1) between the last two steps.
   */
  update(dt: number, beforeStep: (stepDt: number) => void, maxSubsteps = MAX_SUBSTEPS): number {
    this.accumulator = Math.min(this.accumulator + dt, PHYSICS_DT * maxSubsteps)
    while (this.accumulator >= PHYSICS_DT) {
      beforeStep(PHYSICS_DT)
      this.world.step()
      this.accumulator -= PHYSICS_DT
    }
    return this.accumulator / PHYSICS_DT
  }

  /** Shifts every rigid body by (-dx, 0, -dz). Used by the floating origin. */
  shift(dx: number, dz: number): void {
    this.world.bodies.forEach((body) => {
      const t = body.translation()
      if (body.isKinematic()) {
        body.setNextKinematicTranslation({ x: t.x - dx, y: t.y, z: t.z - dz })
      }
      body.setTranslation({ x: t.x - dx, y: t.y, z: t.z - dz }, false)
    })
  }

  dispose(): void {
    this.world.free()
  }
}
