import { describe, expect, it } from 'vitest'
import { hash2, mulberry32 } from '../../core/rng'
import { buildChunkMesh, sampleChunkHeights } from './chunkMesh'
import { WATER_LEVEL } from '../constants'
import { createHeightSampler, createTerrainPoint, createWorldGen } from './heightSampler'
import { MAP_TILE_PX, mapTilePixels } from './mapTile'
import { findFlatSpot } from './spawn'

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
  const gen = createWorldGen(seed)
  const sample = gen.height

  it('same seed and coords give identical chunks', () => {
    const a = buildChunkMesh(gen, seed, 3, -7, 16, 2)
    const b = buildChunkMesh(createWorldGen(seed), seed, 3, -7, 16, 2)
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

  it('keeps heights in range, with shallow lakes', () => {
    for (let i = 0; i < 2000; i++) {
      const h = sample(i * 37.1, i * -53.7)
      expect(h).toBeGreaterThan(WATER_LEVEL - 12)
      expect(h).toBeLessThan(260)
    }
  })

  it('has no spikes: height changes smoothly between neighbouring samples', () => {
    for (let i = 0; i < 2000; i++) {
      const x = i * 97.3
      const z = i * -41.9
      // 1 m apart: slope stays under ~70 degrees.
      expect(Math.abs(sample(x + 1, z) - sample(x, z))).toBeLessThan(2.8)
    }
  })

  it('biome weights sum to 1 and every biome exists', () => {
    const pt = createTerrainPoint()
    const seen = new Set<number>()
    for (let i = 0; i < 40000; i++) {
      gen.sample(i * 211.7, i * -157.3, pt)
      expect(pt.valley + pt.hills + pt.alpine + pt.lake).toBeCloseTo(1, 6)
      expect(pt.hills).toBeGreaterThanOrEqual(-1e-9)
      expect(pt.height).toBe(sample(i * 211.7, i * -157.3))
      seen.add(pt.biome)
    }
    expect(seen.size).toBe(4)
  })

  it('builds deterministic map tiles', () => {
    const a = mapTilePixels(gen, 4, -2, 'terrain')
    expect(a.length).toBe(MAP_TILE_PX * MAP_TILE_PX * 4)
    expect(a).toEqual(mapTilePixels(createWorldGen(seed), 4, -2, 'terrain'))
    expect(a).not.toEqual(mapTilePixels(gen, 4, -2, 'biomes'))
  })
})

describe('spawn', () => {
  it('finds a deterministic, reasonably flat spot', () => {
    const sample = createHeightSampler(1337)
    const a = findFlatSpot(sample)
    expect(findFlatSpot(createHeightSampler(1337))).toEqual(a)
    expect(Math.abs(sample(a.x + 4, a.z) - sample(a.x - 4, a.z))).toBeLessThan(2)
  })
})
