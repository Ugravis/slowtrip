import { describe, expect, it } from 'vitest'
import { hash2, mulberry32 } from '../../core/rng'
import { buildChunkMesh, sampleChunkHeights } from './chunkMesh'
import { createHeightSampler } from './heightSampler'

describe('rng', () => {
  it('is deterministic', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 10; i++) expect(a()).toBe(b())
    expect(hash2(1, 2, 3)).toBe(hash2(1, 2, 3))
    expect(hash2(1, 2, 3)).not.toBe(hash2(1, 3, 2))
  })
})

describe('terrain generation', () => {
  const seed = 1337
  const sample = createHeightSampler(seed)

  it('same seed and coords give identical chunks', () => {
    const other = createHeightSampler(seed)
    const a = buildChunkMesh(sample, seed, 3, -7, 16, 2)
    const b = buildChunkMesh(other, seed, 3, -7, 16, 2)
    expect(a.positions).toEqual(b.positions)
    expect(a.colors).toEqual(b.colors)
  })

  it('different seeds give different terrain', () => {
    const other = createHeightSampler(seed + 1)
    expect(sample(100, 100)).not.toBe(other(100, 100))
  })

  it('neighbouring chunks share their border heights', () => {
    const res = 32
    const n = res + 1
    const left = sampleChunkHeights(sample, 0, 0, res)
    const right = sampleChunkHeights(sample, 1, 0, res)
    for (let iz = 0; iz < n; iz++) expect(left[res * n + iz]).toBe(right[iz])
  })

  it('LOD levels match on shared vertices', () => {
    const hi = sampleChunkHeights(sample, 2, 5, 32)
    const lo = sampleChunkHeights(sample, 2, 5, 8)
    // Every 4th high-res vertex coincides with a low-res vertex.
    for (let i = 0; i <= 8; i++) expect(hi[i * 4 * 33 + i * 4]).toBe(lo[i * 9 + i])
  })

  it('keeps heights in a drivable range', () => {
    for (let i = 0; i < 2000; i++) {
      const h = sample(i * 37.1, i * -53.7)
      expect(h).toBeGreaterThan(-60)
      expect(h).toBeLessThan(90)
    }
  })
})
