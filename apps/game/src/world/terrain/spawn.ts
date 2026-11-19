import { WATER_LEVEL } from '../constants'
import type { HeightSampler } from './heightSampler'

/**
 * Finds the flattest spot near (0, 0) for spawning vehicles, scanning a grid deterministically.
 * Flatness = height range over a footprint of `radius` meters. Lake beds and shores are skipped.
 */
export function findFlatSpot(
  sample: HeightSampler,
  searchRadius = 192,
  radius = 8,
): { x: number; z: number } {
  let best = { x: 0, z: 0 }
  let bestScore = Infinity
  const step = 16
  for (let x = -searchRadius; x <= searchRadius; x += step) {
    for (let z = -searchRadius; z <= searchRadius; z += step) {
      let lo = Infinity
      let hi = -Infinity
      for (let dx = -radius; dx <= radius; dx += radius / 2) {
        for (let dz = -radius; dz <= radius; dz += radius / 2) {
          const h = sample(x + dx, z + dz)
          if (h < lo) lo = h
          if (h > hi) hi = h
        }
      }
      if (lo < WATER_LEVEL + 0.5) continue
      // Prefer flat ground, then proximity to the origin.
      const score = hi - lo + Math.hypot(x, z) * 0.002
      if (score < bestScore) {
        bestScore = score
        best = { x, z }
      }
    }
  }
  return best
}
