import { createNoise2D, type NoiseFunction2D } from 'simplex-noise'
import { mulberry32 } from '../../core/rng'
import { WATER_LEVEL } from '../constants'
import { ROAD_FLAT_HALF, ROAD_MAX_BANK, RoadNetwork, type RoadHit } from '../road/roadNetwork'
import { Biome } from './biomes'

export type HeightSampler = (x: number, z: number) => number

/** Terrain sample: height plus biome weights (valley + hills + alpine + lake = 1). */
export interface TerrainPoint {
  height: number
  valley: number
  hills: number
  alpine: number
  lake: number
  /** Distance to the road centerline (m), Infinity when out of the road's reach. */
  road: number
  /** Dominant biome. */
  biome: Biome
}

export interface WorldGen {
  height: HeightSampler
  /** Main road, placed on the raw terrain. The terrain is leveled around it. */
  roads: RoadNetwork
  /** Fills `out` with the height and biome at world coordinates (x, z). */
  sample(x: number, z: number, out: TerrainPoint): TerrainPoint
}

export const createTerrainPoint = (): TerrainPoint => ({
  height: 0,
  valley: 0,
  hills: 0,
  alpine: 0,
  lake: 0,
  road: Infinity,
  biome: Biome.Valley,
})

/** Biome field scale (m): one biome region spans roughly this distance. */
const BIOME_SCALE = 2600
/** Great lake field scale (m). Great lakes only appear where this field peaks: rare. */
const LAKE_SCALE = 3400
/** Lake beds are flattened: depth below the water line is scaled by this factor. */
const LAKE_DEPTH = 0.4
/** Ridge crest rounding: higher = softer mountain crests (no knife-edge spikes). */
const RIDGE_SOFTNESS = 0.14
/** Ridged octave gain: below 0.5, so fine octaves add less slope than coarse ones. */
const RIDGE_GAIN = 0.4

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Fractal noise normalized to about [-1, 1]. Octaves are offset to avoid aligned artifacts. */
function fbm(noise: NoiseFunction2D, x: number, z: number, octaves: number, gain = 0.5): number {
  let sum = 0
  let amp = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x, z)
    norm += amp
    amp *= gain
    x = x * 2 + 19.1
    z = z * 2 - 7.3
  }
  return sum / norm
}

/**
 * Ridged multifractal in [0, 1] with rounded crests (soft absolute value).
 * Higher octaves are weighted by the lower ones: detail concentrates on ridges, valleys stay smooth.
 */
function ridged(noise: NoiseFunction2D, x: number, z: number, octaves: number): number {
  const k = RIDGE_SOFTNESS
  let sum = 0
  let amp = 1
  let norm = 0
  let weight = 1
  for (let i = 0; i < octaves; i++) {
    const n = noise(x, z)
    let r = 1 + k - Math.sqrt(n * n + k * k)
    r *= r * weight
    weight = clamp01(r * 1.6)
    sum += r * amp
    norm += amp
    amp *= RIDGE_GAIN
    x = x * 2.03 + 31.7
    z = z * 2.03 - 11.9
  }
  return sum / norm
}

/**
 * Deterministic terrain from the seed: a warped low-frequency field picks the biome
 * (valley < hills < alpine), a rarer field carves great lakes, each biome has its own height function, and heights are blended
 * by biome weight so borders are continuous. Chunks sampled independently always match.
 */
export function createWorldGen(seed: number): WorldGen {
  const rand = mulberry32(seed)
  const biomeN = createNoise2D(rand)
  const warpX = createNoise2D(rand)
  const warpZ = createNoise2D(rand)
  const baseN = createNoise2D(rand)
  const valleyN = createNoise2D(rand)
  const hillsN = createNoise2D(rand)
  const massifN = createNoise2D(rand)
  const ridgeN = createNoise2D(rand)
  const detailN = createNoise2D(rand)
  const lakeN = createNoise2D(rand)

  const sampleRaw = (x: number, z: number, out: TerrainPoint): TerrainPoint => {
    // Biome field, domain-warped for organic borders.
    const wx = x + warpX(x / 1100, z / 1100) * 200
    const wz = z + warpZ(x / 1100, z / 1100) * 200
    // Great lakes: where the lake field peaks, the biome field is pushed down so lakes sit in
    // valleys and low hills (no cliffs into the water), then the lake basin takes over.
    const l = fbm(lakeN, wx / LAKE_SCALE, wz / LAKE_SCALE, 2)
    const lake = smoothstep(0.46, 0.6, l)
    const m = fbm(biomeN, wx / BIOME_SCALE, wz / BIOME_SCALE, 2) - smoothstep(0.1, 0.52, l) * 0.6
    const land = 1 - lake
    const alpine = smoothstep(0.0, 0.42, m) * land
    const valley = (1 - smoothstep(-0.34, -0.06, m)) * land
    const hills = land - alpine - valley

    // Shared broad undulation, then each biome's relief, skipped when its weight is zero.
    let h = fbm(baseN, x / 1600, z / 1600, 2) * 8
    if (valley > 0) h += valley * (3 + fbm(valleyN, x / 520, z / 520, 3, 0.45) * 7)
    if (hills > 0) h += hills * (16 + fbm(hillsN, x / 360, z / 360, 4, 0.45) * 20)
    if (alpine > 0) {
      const massif = fbm(massifN, x / 1400, z / 1400, 2) * 0.5 + 0.5
      const r = ridged(ridgeN, x / 950, z / 950, 4)
      h += alpine * (28 + massif * 30 + r * (90 + 80 * massif))
    }
    if (lake > 0) h += lake * (-16 + fbm(valleyN, x / 700, z / 700, 2) * 4)
    // Light surface detail, a bit rougher in the mountains.
    h += fbm(detailN, x / 70, z / 70, 2) * (0.4 + alpine * 0.6)
    if (h < WATER_LEVEL) h = WATER_LEVEL + (h - WATER_LEVEL) * LAKE_DEPTH

    out.height = h
    out.valley = valley
    out.hills = hills
    out.alpine = alpine
    out.lake = lake
    let biome: Biome = Biome.Valley
    let best = valley
    if (hills > best) {
      biome = Biome.Hills
      best = hills
    }
    if (alpine > best) {
      biome = Biome.Alpine
      best = alpine
    }
    if (lake > best) biome = Biome.Lake
    out.biome = biome
    out.road = Infinity
    return out
  }

  // The road is laid out on the raw terrain, then the terrain is leveled around it:
  // flat platform, then a cut or fill slope whose width grows with the height gap.
  const roads = new RoadNetwork(seed, sampleRaw)
  const hit: RoadHit = { dist: 0, h: 0, bridge: false }
  const sample = (x: number, z: number, out: TerrainPoint): TerrainPoint => {
    sampleRaw(x, z, out)
    if (roads.query(x, z, hit)) {
      const raw = out.height
      // Under a bridge only dry ground is leveled (approach embankments, flush with the deck
      // ends), fading out at the water line: the lake itself is left untouched.
      const dry = hit.bridge ? smoothstep(WATER_LEVEL - 1.5, WATER_LEVEL + 0.5, raw) : 1
      if (dry > 0) {
        const gap = Math.abs(raw - hit.h)
        const bank = Math.min(ROAD_MAX_BANK, Math.max(3, gap * 1.6 + 2))
        const t = smoothstep(ROAD_FLAT_HALF, ROAD_FLAT_HALF + bank, hit.dist)
        out.height = raw + (hit.h + (raw - hit.h) * t - raw) * dry
      }
      out.road = hit.dist
    }
    return out
  }

  const scratch = createTerrainPoint()
  return { sample, roads, height: (x, z) => sample(x, z, scratch).height }
}

/** Terrain height in meters at world coordinates (x, z). Depends only on the seed. */
export function createHeightSampler(seed: number): HeightSampler {
  return createWorldGen(seed).height
}
