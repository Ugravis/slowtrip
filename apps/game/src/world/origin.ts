import { CHUNK_SIZE, ORIGIN_REBASE_DISTANCE } from './constants'

/**
 * Floating origin. Scene and physics positions are local (float32-safe);
 * world position = local + origin. The origin is stored as float64 and always
 * snapped to chunk multiples.
 */
export class WorldOrigin {
  x = 0
  z = 0

  /**
   * Returns the shift to apply if the local position (lx, lz) is too far from
   * the origin, or null. The caller must move everything by (-dx, -dz) and then call `apply`.
   */
  rebaseFor(lx: number, lz: number): { dx: number; dz: number } | null {
    if (Math.abs(lx) < ORIGIN_REBASE_DISTANCE && Math.abs(lz) < ORIGIN_REBASE_DISTANCE) return null
    const dx = Math.round(lx / CHUNK_SIZE) * CHUNK_SIZE
    const dz = Math.round(lz / CHUNK_SIZE) * CHUNK_SIZE
    return { dx, dz }
  }

  apply(dx: number, dz: number): void {
    this.x += dx
    this.z += dz
  }
}
