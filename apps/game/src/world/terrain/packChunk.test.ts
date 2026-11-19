import { describe, expect, it } from 'vitest'
import { packChunk, unpackChunkX, unpackChunkZ } from './TerrainSystem'

describe('packChunk', () => {
  it('round-trips negative and large coordinates', () => {
    for (const [cx, cz] of [
      [0, 0],
      [-1, 5],
      [12345, -67890],
      [-1_000_000, 1_000_000],
    ] as const) {
      const key = packChunk(cx, cz)
      expect(unpackChunkX(key)).toBe(cx)
      expect(unpackChunkZ(key)).toBe(cz)
    }
  })

  it('gives distinct keys to neighbours', () => {
    expect(packChunk(0, 1)).not.toBe(packChunk(1, 0))
  })
})
