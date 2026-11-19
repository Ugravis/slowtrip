import { createNoise2D } from 'simplex-noise'
import { mulberry32 } from '../../core/rng'

export type HeightSampler = (x: number, z: number) => number

/**
 * Terrain height in meters at world coordinates (x, z).
 * Depends only on the seed: chunks sampled independently always match at their borders.
 */
export function createHeightSampler(seed: number): HeightSampler {
  const rand = mulberry32(seed)
  const continental = createNoise2D(rand)
  const hills = createNoise2D(rand)
  const detail = createNoise2D(rand)

  return (x, z) => {
    const c = continental(x / 900, z / 900) // [-1, 1]
    const base = c * 28
    // Ridged hills, stronger where the continental layer is high.
    const h = 1 - Math.abs(hills(x / 260, z / 260))
    const hillMask = 0.35 + 0.65 * (c * 0.5 + 0.5)
    const hilly = h * h * 22 * hillMask
    const fine = detail(x / 45, z / 45) * 1.2
    return base + hilly + fine
  }
}
