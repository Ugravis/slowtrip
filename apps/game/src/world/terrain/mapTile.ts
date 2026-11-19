import { CHUNK_SIZE, WATER_LEVEL } from '../constants'
import { BIOME_SRGB, terrainColor, WATER_SRGB } from './biomes'
import { createTerrainPoint, type WorldGen } from './heightSampler'

export type MapLayer = 'terrain' | 'biomes'

/** Pixels per tile edge (one tile = one terrain chunk). */
export const MAP_TILE_PX = 32

const _rgb = new Float32Array(3)

/**
 * RGBA pixels of the top-down map tile for chunk (cx, cz): terrain or biome colors with a
 * hillshade lit from the north-west, and water over lakes. Pure and deterministic.
 */
export function mapTilePixels(
  gen: WorldGen,
  cx: number,
  cz: number,
  layer: MapLayer,
): Uint8ClampedArray<ArrayBuffer> {
  const n = MAP_TILE_PX
  const g = n + 1
  const step = CHUNK_SIZE / n
  const h = new Float32Array(g * g)
  const wv = new Float32Array(g * g)
  const wa = new Float32Array(g * g)
  const wl = new Float32Array(g * g)
  const pt = createTerrainPoint()
  const ox = cx * CHUNK_SIZE
  const oz = cz * CHUNK_SIZE
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      gen.sample(ox + i * step, oz + j * step, pt)
      const k = j * g + i
      h[k] = pt.height
      wv[k] = pt.valley
      wa[k] = pt.alpine
      wl[k] = pt.lake
    }
  }

  const px = new Uint8ClampedArray(n * n * 4)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * g + i
      const h00 = h[k] as number
      const h10 = h[k + 1] as number
      const h01 = h[k + g] as number
      const h11 = h[k + g + 1] as number
      const y = (h00 + h10 + h01 + h11) / 4
      const gx = (h10 + h11 - h00 - h01) / (2 * step)
      const gz = (h01 + h11 - h00 - h10) / (2 * step)
      const ny = 1 / Math.sqrt(1 + gx * gx + gz * gz)
      const valley = wv[k] as number
      const alpine = wa[k] as number
      const lake = wl[k] as number
      const hills = 1 - valley - alpine - lake
      let shade: number
      if (y < WATER_LEVEL) {
        // Water: flat color, darker with depth.
        _rgb[0] = WATER_SRGB[0]
        _rgb[1] = WATER_SRGB[1]
        _rgb[2] = WATER_SRGB[2]
        shade = 1 + Math.max(-0.25, (y - WATER_LEVEL) * 0.06)
      } else {
        if (layer === 'biomes') {
          const a = BIOME_SRGB[0] as readonly number[]
          const b = BIOME_SRGB[1] as readonly number[]
          const c = BIOME_SRGB[2] as readonly number[]
          const d = BIOME_SRGB[3] as readonly number[]
          for (let ch = 0; ch < 3; ch++) {
            _rgb[ch] =
              (a[ch] as number) * valley +
              (b[ch] as number) * hills +
              (c[ch] as number) * alpine +
              (d[ch] as number) * lake
          }
        } else {
          terrainColor(_rgb, 0, y, ny, valley, hills, alpine, lake)
        }
        const lit = Math.max(-1, Math.min(1, (gx + gz) * 0.9))
        shade = 0.86 + 0.3 * lit + Math.max(-0.08, Math.min(0.12, y * 0.0012))
      }
      const o = (j * n + i) * 4
      px[o] = (_rgb[0] as number) * shade * 255
      px[o + 1] = (_rgb[1] as number) * shade * 255
      px[o + 2] = (_rgb[2] as number) * shade * 255
      px[o + 3] = 255
    }
  }
  return px
}
