import { WATER_LEVEL } from '../constants'
import { BIOME_SRGB, terrainColor, WATER_SRGB } from '../terrain/biomes'
import { createTerrainPoint, type WorldGen } from '../terrain/heightSampler'
import type { MapLayer } from '../terrain/mapTile'
import { bandOf } from './roadNetwork'

/** Dev tool: top-down overview of the world and the main road (full map, CLI script). */
export interface OverviewArea {
  /** World center of the area (m). */
  centerX: number
  centerZ: number
  /** Area size (m), east-west and north-south. */
  width: number
  height: number
  /** Meters per pixel. */
  scale: number
  /** Same palettes as the map layers. Default: terrain. */
  layer?: MapLayer
}

export interface Overview {
  width: number
  height: number
  /** World position of the top-left (north-west) corner. */
  x0: number
  z0: number
  scale: number
  /** RGB, row-major, north up. */
  rgb: Uint8Array
}

const ROAD_RGB = [230, 40, 40]
const BRIDGE_RGB = [255, 210, 40]
const GRID_RGB = [255, 255, 255]

/** Terrain or biome colors (as the map layers) with a hillshade, water, a 1 km grid, and the road (bridges in yellow). */
export function renderOverview(gen: WorldGen, area: OverviewArea): Overview {
  const { scale } = area
  const pt = createTerrainPoint()
  const w = Math.round(area.width / scale)
  const h = Math.round(area.height / scale)
  const x0 = area.centerX - area.width / 2
  const z0 = area.centerZ - area.height / 2
  const rgb = new Uint8Array(w * h * 3)
  const heights = new Float32Array(w * h)
  const weights = new Float32Array(w * h * 4)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i
      gen.sample(x0 + i * scale, z0 + j * scale, pt)
      heights[k] = pt.height
      weights[k * 4] = pt.valley
      weights[k * 4 + 1] = pt.hills
      weights[k * 4 + 2] = pt.alpine
      weights[k * 4 + 3] = pt.lake
    }
  }

  const col = new Float32Array(3)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i
      pt.height = heights[k] as number
      pt.valley = weights[k * 4] as number
      pt.hills = weights[k * 4 + 1] as number
      pt.alpine = weights[k * 4 + 2] as number
      pt.lake = weights[k * 4 + 3] as number
      let c: readonly number[]
      if (pt.height < WATER_LEVEL) c = WATER_SRGB
      else if (area.layer !== 'biomes') {
        const gx = (pt.height - (heights[i > 0 ? k - 1 : k] as number)) / scale
        const gz = (pt.height - (heights[j > 0 ? k - w : k] as number)) / scale
        const ny = 1 / Math.sqrt(1 + gx * gx + gz * gz)
        terrainColor(col, 0, pt.height, ny, pt.valley, pt.hills, pt.alpine, pt.lake)
        c = col as unknown as readonly number[]
      } else {
        const v = BIOME_SRGB[0] as readonly number[]
        const hi = BIOME_SRGB[1] as readonly number[]
        const a = BIOME_SRGB[2] as readonly number[]
        const l = BIOME_SRGB[3] as readonly number[]
        c = [0, 1, 2].map(
          (k) =>
            (v[k] as number) * pt.valley +
            (hi[k] as number) * pt.hills +
            (a[k] as number) * pt.alpine +
            (l[k] as number) * pt.lake,
        )
      }
      const o = (j * w + i) * 3
      rgb[o] = (c[0] as number) * 255
      rgb[o + 1] = (c[1] as number) * 255
      rgb[o + 2] = (c[2] as number) * 255
    }
  }
  // Hillshade lit from the north-west.
  for (let j = 1; j < h; j++) {
    for (let i = 1; i < w; i++) {
      const k = j * w + i
      const hk = heights[k] as number
      if (hk < WATER_LEVEL) continue
      const gx = hk - (heights[k - 1] as number)
      const gz = hk - (heights[k - w] as number)
      const shade = Math.max(0.45, Math.min(1.35, 1 - ((gx + gz) / scale) * 1.2))
      for (let c = 0; c < 3; c++) rgb[k * 3 + c] = Math.min(255, (rgb[k * 3 + c] as number) * shade)
    }
  }
  const plot = (px: number, pz: number, color: readonly number[], r: number) => {
    const ci = Math.round((px - x0) / scale)
    const cj = Math.round((pz - z0) / scale)
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= w || j >= h) continue
        rgb.set(color, (j * w + i) * 3)
      }
    }
  }
  // 1 km grid.
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = x0 + i * scale
      const z = z0 + j * scale
      const onX = Math.abs(x - Math.round(x / 1000) * 1000) < scale / 2
      const onZ = Math.abs(z - Math.round(z / 1000) * 1000) < scale / 2
      if (onX || onZ) {
        const o = (j * w + i) * 3
        for (let c = 0; c < 3; c++) {
          rgb[o + c] = ((rgb[o + c] as number) * 3 + (GRID_RGB[c] as number)) / 4
        }
      }
    }
  }
  const r = scale <= 8 ? 1 : 0
  for (let k = bandOf(z0 + h * scale); k <= bandOf(z0); k++) {
    const d = gen.roads.compute(k)
    for (let n = 0; n < d.x.length; n++) {
      plot(d.x[n] as number, d.z[n] as number, d.bridge[n] ? BRIDGE_RGB : ROAD_RGB, r)
    }
  }
  return { width: w, height: h, x0, z0, scale, rgb }
}
