import { WATER_LEVEL } from '../constants'
import type { RoadNetwork } from '../road/roadNetwork'
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

export interface RoadSpot {
  x: number
  z: number
  /** Heading along the road, northbound (yaw 0 = -Z). */
  yaw: number
}

/**
 * Point on the main road near the start of band 0, `back` meters behind the spawn point and
 * `side` meters right of the centerline (right lane = +1.75). Deterministic.
 */
export function roadSpot(roads: RoadNetwork, back = 0, side = 0): RoadSpot {
  const band = roads.band(0)
  if (!band) throw new Error('Spawn road band not generated')
  const { x, z, dx, dz } = band.data
  // ~60 m into the band, away from the band joint.
  const i = Math.max(0, Math.min(band.count - 1, 15 - Math.round(back / 4)))
  const fx = dx[i] as number
  const fz = dz[i] as number
  return {
    x: (x[i] as number) - fz * side,
    z: (z[i] as number) + fx * side,
    yaw: Math.atan2(-fx, -fz),
  }
}
