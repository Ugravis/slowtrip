import { BAND_LENGTH, RoadGenerator, type RawSampler, type RoadBandData } from './roadGen'

/** Asphalt half width (m): two 3.2 m lanes plus edge lines. */
export const ROAD_HALF_WIDTH = 3.6
/** Half width of the leveled flat platform (asphalt + shoulders), meters. */
export const ROAD_FLAT_HALF = 4.8
/** Widest embankment (cut or fill slope) beyond the platform, meters. */
export const ROAD_MAX_BANK = 30
/** Farther than this from the centerline, the road has no influence. */
export const ROAD_REACH = ROAD_FLAT_HALF + ROAD_MAX_BANK

const CELL = 32
const MAX_BANDS = 24
/** Smoothing can push samples slightly past their band's z range. */
const BAND_SLACK = 48

export interface RoadHit {
  /** Distance to the centerline (m). */
  dist: number
  /** Road surface height at the closest centerline point. */
  h: number
  /** The closest centerline point is on a bridge. */
  bridge: boolean
}

/** One band's samples plus a uniform grid of segment indices within ROAD_REACH of each cell. */
export class RoadBand {
  readonly count: number
  private readonly gx0: number
  private readonly gz0: number
  private readonly cols: number
  private readonly rows: number
  private readonly cellStart: Int32Array
  private readonly cellItems: Int32Array

  constructor(readonly data: RoadBandData) {
    const { x, z } = data
    this.count = x.length
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < this.count; i++) {
      const px = x[i] as number
      const pz = z[i] as number
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (pz < minZ) minZ = pz
      if (pz > maxZ) maxZ = pz
    }
    this.gx0 = Math.floor((minX - ROAD_REACH) / CELL)
    this.gz0 = Math.floor((minZ - ROAD_REACH) / CELL)
    this.cols = Math.floor((maxX + ROAD_REACH) / CELL) - this.gx0 + 1
    this.rows = Math.floor((maxZ + ROAD_REACH) / CELL) - this.gz0 + 1
    const cells = this.cols * this.rows
    // Two passes (count, then fill): compact CSR layout.
    const counts = new Int32Array(cells + 1)
    const visit = (fill: Int32Array | null, cursor: Int32Array | null) => {
      for (let i = 0; i < this.count - 1; i++) {
        const ax = x[i] as number
        const bx = x[i + 1] as number
        const az = z[i] as number
        const bz = z[i + 1] as number
        const c0 = Math.floor((Math.min(ax, bx) - ROAD_REACH) / CELL) - this.gx0
        const c1 = Math.floor((Math.max(ax, bx) + ROAD_REACH) / CELL) - this.gx0
        const r0 = Math.floor((Math.min(az, bz) - ROAD_REACH) / CELL) - this.gz0
        const r1 = Math.floor((Math.max(az, bz) + ROAD_REACH) / CELL) - this.gz0
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const cell = r * this.cols + c
            if (fill && cursor) {
              fill[cursor[cell] as number] = i
              cursor[cell] = (cursor[cell] as number) + 1
            } else counts[cell + 1] = (counts[cell + 1] as number) + 1
          }
        }
      }
    }
    visit(null, null)
    for (let c = 0; c < cells; c++)
      counts[c + 1] = (counts[c + 1] as number) + (counts[c] as number)
    this.cellStart = counts
    this.cellItems = new Int32Array(counts[cells] as number)
    visit(this.cellItems, counts.slice(0, cells))
  }

  /** Updates `hit` if a centerline point of this band is closer than `hit.dist`. */
  nearest(px: number, pz: number, hit: RoadHit): void {
    const c = Math.floor(px / CELL) - this.gx0
    const r = Math.floor(pz / CELL) - this.gz0
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return
    const cell = r * this.cols + c
    const { x, z, h, bridge } = this.data
    const end = this.cellStart[cell + 1] as number
    let best2 = hit.dist * hit.dist
    for (let k = this.cellStart[cell] as number; k < end; k++) {
      const i = this.cellItems[k] as number
      const ax = x[i] as number
      const az = z[i] as number
      const ex = (x[i + 1] as number) - ax
      const ez = (z[i + 1] as number) - az
      const l2 = ex * ex + ez * ez
      let t = l2 > 0 ? ((px - ax) * ex + (pz - az) * ez) / l2 : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const dx = ax + ex * t - px
      const dz = az + ez * t - pz
      const d2 = dx * dx + dz * dz
      if (d2 < best2) {
        best2 = d2
        hit.dist = Math.sqrt(d2)
        const ha = h[i] as number
        hit.h = ha + ((h[i + 1] as number) - ha) * t
        hit.bridge = bridge[t < 0.5 ? i : i + 1] === 1
      }
    }
  }
}

export interface RoadSpot {
  x: number
  z: number
  /** Northbound heading (yaw 0 = -Z). */
  yaw: number
}

/** Band index containing world z. */
export const bandOf = (z: number) => Math.floor(-z / BAND_LENGTH)

/**
 * Road bands cache and closest-point queries.
 * `generate = true`: missing bands are computed synchronously (workers).
 * `generate = false`: missing bands are reported to `onMissing` and treated as roadless until
 * `insert` provides them (main thread, fed by a worker so it never stalls).
 */
export class RoadNetwork {
  generate = true
  onMissing: ((k: number) => void) | null = null
  private readonly gen: RoadGenerator
  private readonly bands = new Map<number, RoadBand>()
  private readonly requested = new Set<number>()

  constructor(seed: number, raw: RawSampler) {
    this.gen = new RoadGenerator(seed, raw)
  }

  /** Computes band k now (no caching): worker API. */
  compute(k: number): RoadBandData {
    return this.gen.band(k)
  }

  insert(k: number, data: RoadBandData): void {
    this.requested.delete(k)
    this.bands.set(k, new RoadBand(data))
    if (this.bands.size > MAX_BANDS) this.bands.delete(this.bands.keys().next().value as number)
  }

  has(k: number): boolean {
    return this.bands.has(k)
  }

  band(k: number): RoadBand | null {
    const b = this.bands.get(k)
    if (b) return b
    if (this.generate) {
      this.insert(k, this.gen.band(k))
      return this.bands.get(k) as RoadBand
    }
    if (!this.requested.has(k)) {
      this.requested.add(k)
      this.onMissing?.(k)
    }
    return null
  }

  /**
   * Closest road sample to (x, z) within `maxDist`, moved `side` meters right of the
   * centerline (right lane = +1.75). Generates the bands it needs, even in passive mode.
   */
  closestSpot(x: number, z: number, maxDist: number, side: number): RoadSpot | null {
    const generate = this.generate
    this.generate = true
    let best: RoadSpot | null = null
    let best2 = maxDist * maxDist
    for (let k = bandOf(z + maxDist + BAND_SLACK); k <= bandOf(z - maxDist - BAND_SLACK); k++) {
      if (x < this.gen.xMin(k) - maxDist || x > this.gen.xMax(k) + maxDist) continue
      const band = this.band(k) as RoadBand
      const d = band.data
      for (let i = 0; i < band.count; i++) {
        const ex = (d.x[i] as number) - x
        const ez = (d.z[i] as number) - z
        const d2 = ex * ex + ez * ez
        if (d2 >= best2) continue
        best2 = d2
        const fx = d.dx[i] as number
        const fz = d.dz[i] as number
        best = {
          x: (d.x[i] as number) - fz * side,
          z: (d.z[i] as number) + fx * side,
          yaw: Math.atan2(-fx, -fz),
        }
      }
    }
    this.generate = generate
    return best
  }

  /** Closest centerline point within ROAD_REACH. Returns false when no road is that close. */
  query(x: number, z: number, hit: RoadHit): boolean {
    hit.dist = ROAD_REACH
    const k0 = bandOf(z + ROAD_REACH + BAND_SLACK)
    const k1 = bandOf(z - ROAD_REACH - BAND_SLACK)
    for (let k = k0; k <= k1; k++) {
      // Far from any possible road of this band: skip without generating it.
      if (x < this.gen.xMin(k) - ROAD_REACH || x > this.gen.xMax(k) + ROAD_REACH) continue
      this.band(k)?.nearest(x, z, hit)
    }
    return hit.dist < ROAD_REACH
  }
}
