import { describe, expect, it } from 'vitest'
import { CHUNK_SIZE } from '../constants'
import { createWorldGen } from './heightSampler'
import { FEATURE_REGION, regionFeatures } from './mapFeatures'

const REGION_M = FEATURE_REGION * CHUNK_SIZE

/** Two round summits at x = 120 and x = 400 joined by a ridge: one pass at about x = 260. */
const twinPeaks = (x: number, z: number) => {
  const bump = (cx: number, r: number, a: number) =>
    a * Math.exp(-((x - cx) ** 2 + z ** 2) / (r * r))
  const ridge = 70 * Math.exp(-(z * z) / (90 * 90))
  return bump(120, 110, 70) + bump(400, 110, 70) + ridge
}

describe('map features', () => {
  it('finds both summits and the pass between them', () => {
    const f = [-1, 0].flatMap((rz) => regionFeatures(twinPeaks, 0, rz))
    const peaks = f.filter((p) => p.kind === 'peak')
    const passes = f.filter((p) => p.kind === 'pass')
    const xs = peaks.map((p) => p.x).sort((a, b) => a - b)
    expect(xs).toHaveLength(2)
    // The ridge pulls each summit slightly toward the other.
    expect(Math.abs((xs[0] ?? 0) - 120)).toBeLessThan(24)
    expect(Math.abs((xs[1] ?? 0) - 400)).toBeLessThan(24)
    expect(passes).toHaveLength(1)
    expect(Math.abs((passes[0]?.x ?? 0) - 260)).toBeLessThan(40)
    expect(Math.abs(passes[0]?.z ?? 99)).toBeLessThan(20)
  })

  it('is deterministic and every feature belongs to its own region', () => {
    const gen = createWorldGen(1337)
    for (let r = -2; r <= 2; r++) {
      const a = regionFeatures(gen.height, r, 3)
      expect(regionFeatures(createWorldGen(1337).height, r, 3)).toEqual(a)
      for (const p of a) {
        expect(Math.floor(p.x / REGION_M)).toBe(r)
        expect(Math.floor(p.z / REGION_M)).toBe(3)
      }
    }
  })
})
