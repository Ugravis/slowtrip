import { WATER_LEVEL } from '../constants'

export type Rgb = readonly [number, number, number]

export const Biome = { Valley: 0, Hills: 1, Alpine: 2, Lake: 3 } as const
export type Biome = (typeof Biome)[keyof typeof Biome]

export const BIOME_NAMES: readonly string[] = ['Valley', 'Hills', 'Alpine', 'Great lake']

/** Flat biome colors for the map's biome layer (sRGB, [0, 1]). */
export const BIOME_SRGB: readonly Rgb[] = [
  [0.36, 0.66, 0.34],
  [0.86, 0.72, 0.36],
  [0.6, 0.55, 0.72],
  [0.36, 0.72, 0.78],
]

/** Water color on the map and in the scene (sRGB). */
export const WATER_SRGB: Rgb = [0.25, 0.5, 0.66]

/** Terrain palette (sRGB, [0, 1]), shared by meshes and the map. */
const C = {
  sand: [0.79, 0.72, 0.5],
  wetSand: [0.58, 0.53, 0.38],
  valleyGrass: [0.4, 0.55, 0.27],
  hillsGrass: [0.47, 0.57, 0.28],
  hillsDry: [0.62, 0.6, 0.33],
  alpineGrass: [0.4, 0.5, 0.29],
  lakeshore: [0.5, 0.56, 0.33],
  scree: [0.56, 0.54, 0.5],
  rock: [0.48, 0.45, 0.42],
  snow: [0.93, 0.94, 0.96],
} satisfies Record<string, Rgb>

/** Shore band above the water line, in meters. */
const SHORE = 0.6

function valleyColor(_y: number, ny: number): Rgb {
  return ny < 0.78 ? C.rock : C.valleyGrass
}

function hillsColor(y: number, ny: number): Rgb {
  if (ny < 0.8) return C.rock
  return y > 30 ? C.hillsDry : C.hillsGrass
}

function alpineColor(y: number, ny: number): Rgb {
  if (y > 125 && ny > 0.62) return C.snow
  if (ny < 0.74) return C.rock
  if (y > 110 || ny < 0.82) return C.scree
  return C.alpineGrass
}

/**
 * Writes the sRGB terrain color at height `y` (m) with normal y `ny` into `out[o..o+2]`,
 * blending the per-biome colors by their weights so biome borders stay soft.
 */
export function terrainColor(
  out: { [i: number]: number },
  o: number,
  y: number,
  ny: number,
  valley: number,
  hills: number,
  alpine: number,
  lake: number,
): void {
  if (y < WATER_LEVEL + SHORE) {
    const c = y < WATER_LEVEL ? C.wetSand : C.sand
    out[o] = c[0]
    out[o + 1] = c[1]
    out[o + 2] = c[2]
    return
  }
  let r = 0
  let g = 0
  let b = 0
  if (valley > 0) {
    const c = valleyColor(y, ny)
    r += c[0] * valley
    g += c[1] * valley
    b += c[2] * valley
  }
  if (hills > 0) {
    const c = hillsColor(y, ny)
    r += c[0] * hills
    g += c[1] * hills
    b += c[2] * hills
  }
  if (alpine > 0) {
    const c = alpineColor(y, ny)
    r += c[0] * alpine
    g += c[1] * alpine
    b += c[2] * alpine
  }
  if (lake > 0) {
    const c = ny < 0.78 ? C.rock : C.lakeshore
    r += c[0] * lake
    g += c[1] * lake
    b += c[2] * lake
  }
  out[o] = r
  out[o + 1] = g
  out[o + 2] = b
}
