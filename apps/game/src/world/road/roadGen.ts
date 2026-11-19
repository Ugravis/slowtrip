import { createNoise2D, type NoiseFunction2D } from 'simplex-noise'
import { mulberry32 } from '../../core/rng'
import { WATER_LEVEL } from '../constants'
import type { TerrainPoint } from '../terrain/heightSampler'

/**
 * Infinite main road, placed on the raw terrain.
 *
 * The road heads north (-Z) through bands of BAND_LENGTH meters. Band k spans
 * -z in [k * BAND_LENGTH, (k + 1) * BAND_LENGTH]. Each band boundary gets a waypoint chosen from
 * the terrain (gentle, not a summit, not water) around a bounded meander line, so the road
 * drifts but always goes north. Between two waypoints, A* on a 16 m grid finds the path:
 * steep grades cost a lot, so the road follows valleys and passes, never summits.
 * The path is then smoothed and given a smooth vertical profile.
 *
 * Every band depends only on (seed, k). Smoothing uses fixed-size windows over the neighbor
 * bands' raw paths, so two bands always agree on their shared points.
 */

/** Band length along -Z (m). */
export const BAND_LENGTH = 1024
/** A* grid step (m). Waypoints snap to it. */
const GRID = 16
const ROWS = BAND_LENGTH / GRID
/** Road sample spacing (m). */
const SAMPLE_STEP = 4
/** Meander line: lateral amplitude (m) and frequency (per band). */
const MEANDER_AMP = 1600
const MEANDER_FREQ = 0.09
/** Waypoint search range (m) around the meander line, and candidate step (multiple of GRID). */
const WAYPOINT_RANGE = 512
const WAYPOINT_STEP = 32
/** Extra A* corridor width (m) on each side of the two waypoints. */
const CORRIDOR_MARGIN = 640
/** Grade (rise / run) above which the A* cost explodes. */
const MAX_GRADE = 0.1
/** Comfortable grade: cost grows quadratically past it. */
const SOFT_GRADE = 0.05
/** Lateral smoothing of the path: box blur radius (samples) and passes. */
const POS_RADIUS = 8
const POS_PASSES = 3
/**
 * Vertical profile smoothing: box blur over arc length (m), capped in samples, and passes.
 * Arc length, not sample index: the lateral smoothing tightens hairpins, which would steepen them.
 */
const H_ARC = 60
const H_RADIUS = 30
const H_PASSES = 3
/** Grade limit of the profile (cut and fill absorb the difference), and its window (samples). */
const PROFILE_GRADE = 0.1
const GRADE_RADIUS = 200
/** Neighbor samples needed for exact agreement between bands (total filter support + tangent). */
const CONTEXT = POS_RADIUS * POS_PASSES + H_RADIUS * (H_PASSES + 1) + GRADE_RADIUS + 8
/** The road never goes lower on land. */
export const ROAD_MIN_HEIGHT = WATER_LEVEL + 1.2
/** Bridge deck height above the water (m). */
export const BRIDGE_CLEARANCE = 5
/** Below this raw height the road is on a bridge. */
const BRIDGE_BELOW = WATER_LEVEL + 0.3
/** Bridges extend this many samples past the water line (abutments). */
const BRIDGE_PAD = 3
/** A* cost multiplier over water: a short bridge beats a long detour, a wide lake does not. */
const WATER_COST = 8
/** Prominence ring radius (grid cells, 128 m) and cost per meter above the ring mean. */
const PROMINENCE_CELLS = 8
const PROMINENCE_COST = 0.03

/** Raw terrain sampler, without road leveling. */
export type RawSampler = (x: number, z: number, out: TerrainPoint) => TerrainPoint

/** Final road samples of one band, from waypoint k to waypoint k + 1. World coordinates. */
export interface RoadBandData {
  x: Float64Array
  z: Float64Array
  /** Road surface height. */
  h: Float64Array
  /** Unit tangent, pointing north (increasing index). */
  dx: Float32Array
  dz: Float32Array
  /** 1 where the road is on a bridge (no terrain leveling, deck and piers instead). */
  bridge: Uint8Array
}

interface RawPath {
  x: Float64Array
  z: Float64Array
}

/** 16-connected moves (grid cells): straight, diagonal and knight moves for smoother angles. */
const MOVES = [
  1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1, 1, 2, 2, 1, -1, 2, -2, 1, 1, -2, 2, -1, -1,
  -2, -2, -1,
]
const DIRS = MOVES.length / 2
/** Move index of (0, +1): one row north. */
const NORTH = 2
/** Sharpest turn between two consecutive moves (rad). A hairpin needs several moves. */
const MAX_TURN = 0.9
/** Cost (m) of a turn, times the squared turn angle (rad). */
const TURN_K = 40
const MOVE_LEN = new Float64Array(DIRS)
const TURN_OK = new Uint8Array(DIRS * DIRS)
const TURN_COST = new Float64Array(DIRS * DIRS)
for (let a = 0; a < DIRS; a++) {
  const ax = MOVES[a * 2] as number
  const az = MOVES[a * 2 + 1] as number
  MOVE_LEN[a] = GRID * Math.hypot(ax, az)
  for (let b = 0; b < DIRS; b++) {
    const bx = MOVES[b * 2] as number
    const bz = MOVES[b * 2 + 1] as number
    const angle = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz))
    TURN_OK[a * DIRS + b] = angle <= MAX_TURN ? 1 : 0
    TURN_COST[a * DIRS + b] = TURN_K * angle * angle
  }
}

/** Min-heap of node indices keyed by f-score (lazy deletion). */
class Heap {
  private nodes: number[] = []
  private keys: number[] = []
  get size(): number {
    return this.nodes.length
  }
  push(node: number, key: number): void {
    const n = this.nodes
    const k = this.keys
    let i = n.length
    n.push(node)
    k.push(key)
    while (i > 0) {
      const p = (i - 1) >> 1
      if ((k[p] as number) <= key) break
      n[i] = n[p] as number
      k[i] = k[p] as number
      i = p
    }
    n[i] = node
    k[i] = key
  }
  pop(): number {
    const n = this.nodes
    const k = this.keys
    const top = n[0] as number
    const lastN = n.pop() as number
    const lastK = k.pop() as number
    const len = n.length
    if (len > 0) {
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        if (l >= len) break
        const r = l + 1
        const c = r < len && (k[r] as number) < (k[l] as number) ? r : l
        if ((k[c] as number) >= lastK) break
        n[i] = n[c] as number
        k[i] = k[c] as number
        i = c
      }
      n[i] = lastN
      k[i] = lastK
    }
    return top
  }
}

/** Box blur of `src` into `dst` with an explicit window sum (bit-identical for identical windows). */
function blur(src: Float64Array, dst: Float64Array, radius: number): void {
  const n = src.length
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - radius)
    const b = Math.min(n - 1, i + radius)
    let s = 0
    for (let j = a; j <= b; j++) s += src[j] as number
    dst[i] = s / (b - a + 1)
  }
}

/**
 * Box blur of `src` into `dst` over arc length: neighbors within `arc` meters along the polyline
 * (and `radius` samples), weighted by their own length. `seg[i]` = length of segment i -> i + 1.
 */
function blurArc(
  src: Float64Array,
  dst: Float64Array,
  seg: Float64Array,
  arc: number,
  radius: number,
): void {
  const n = src.length
  const len = (j: number) =>
    ((j > 0 ? (seg[j - 1] as number) : 0) + (j < n - 1 ? (seg[j] as number) : 0)) * 0.5 + 1e-6
  for (let i = 0; i < n; i++) {
    let s = (src[i] as number) * len(i)
    let w = len(i)
    let d = 0
    for (let j = i - 1; j >= Math.max(0, i - radius); j--) {
      d += seg[j] as number
      if (d > arc) break
      s += (src[j] as number) * len(j)
      w += len(j)
    }
    d = 0
    for (let j = i + 1; j <= Math.min(n - 1, i + radius); j++) {
      d += seg[j - 1] as number
      if (d > arc) break
      s += (src[j] as number) * len(j)
      w += len(j)
    }
    dst[i] = s / w
  }
}

/**
 * Limits the grade to `grade`: midpoint of the upper and lower `grade`-Lipschitz envelopes,
 * searched within `radius` samples. Leaves already gentle sections unchanged.
 */
function limitGrade(
  src: Float64Array,
  dst: Float64Array,
  seg: Float64Array,
  grade: number,
  radius: number,
): void {
  const n = src.length
  for (let i = 0; i < n; i++) {
    const v = src[i] as number
    let hi = v
    let lo = v
    let d = 0
    for (let j = i - 1; j >= Math.max(0, i - radius); j--) {
      d += seg[j] as number
      const u = src[j] as number
      if (u - grade * d > hi) hi = u - grade * d
      if (u + grade * d < lo) lo = u + grade * d
    }
    d = 0
    for (let j = i + 1; j <= Math.min(n - 1, i + radius); j++) {
      d += seg[j - 1] as number
      const u = src[j] as number
      if (u - grade * d > hi) hi = u - grade * d
      if (u + grade * d < lo) lo = u + grade * d
    }
    dst[i] = (hi + lo) * 0.5
  }
}

function blurPasses(v: Float64Array, radius: number, passes: number): Float64Array {
  let a: Float64Array = v
  let b: Float64Array = new Float64Array(v.length)
  for (let p = 0; p < passes; p++) {
    blur(a, b, radius)
    const t = a
    a = b
    b = t
  }
  return a
}

export class RoadGenerator {
  private readonly meander: NoiseFunction2D
  private readonly wiggle: NoiseFunction2D
  private readonly meander0: number
  private readonly pt = {
    height: 0,
    valley: 0,
    hills: 0,
    alpine: 0,
    lake: 0,
    road: Infinity,
    biome: 0,
  } as TerrainPoint
  private readonly waypoints = new Map<number, number>()
  private readonly raws = new Map<number, RawPath>()

  constructor(
    seed: number,
    private readonly raw: RawSampler,
  ) {
    // Own PRNG stream: the terrain noise is unchanged.
    const rand = mulberry32((seed ^ 0x5bd1e995) >>> 0)
    this.meander = createNoise2D(rand)
    this.wiggle = createNoise2D(rand)
    // The meander line passes through x = 0 at the spawn band.
    this.meander0 = this.meander(0, 0.37)
  }

  private rawHeight(x: number, z: number): number {
    return this.raw(x, z, this.pt).height
  }

  private center(k: number): number {
    return MEANDER_AMP * (this.meander(k * MEANDER_FREQ, 0.37) - this.meander0)
  }

  /**
   * Cheap bound of the road's x range in band k (no terrain sampling): waypoints stay within
   * WAYPOINT_RANGE of the meander line, the path within the A* corridor.
   */
  xMin(k: number): number {
    return (
      Math.min(this.center(k), this.center(k + 1)) - WAYPOINT_RANGE - CORRIDOR_MARGIN - GRID * 2
    )
  }

  xMax(k: number): number {
    return (
      Math.max(this.center(k), this.center(k + 1)) + WAYPOINT_RANGE + CORRIDOR_MARGIN + GRID * 2
    )
  }

  /** Waypoint x (m, multiple of GRID) on the boundary z = -k * BAND_LENGTH. */
  waypoint(k: number): number {
    const cached = this.waypoints.get(k)
    if (cached !== undefined) return cached
    const center = this.center(k)
    const c0 = Math.round(center / GRID) * GRID
    const z = -k * BAND_LENGTH
    let best = c0
    let bestCost = Infinity
    for (let off = -WAYPOINT_RANGE; off <= WAYPOINT_RANGE; off += WAYPOINT_STEP) {
      const x = c0 + off
      const h = this.rawHeight(x, z)
      let lo = h
      let hi = h
      for (let d = -32; d <= 32; d += 32) {
        for (let e = -32; e <= 32; e += 32) {
          if (d === 0 && e === 0) continue
          const v = this.rawHeight(x + d, z + e)
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      }
      // Height above the surrounding ring: summits and crests score high, passes and slopes low.
      // Height above the lowest nearby ground: a waypoint halfway up a slope would force the
      // road into a steep climb at the band edge, with no room left for hairpins.
      let ring = 0
      let ringMin = h
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2
        ring += this.rawHeight(x + Math.cos(ang) * 128, z + Math.sin(ang) * 128)
        const far = Math.max(
          WATER_LEVEL,
          this.rawHeight(x + Math.cos(ang) * 256, z + Math.sin(ang) * 256),
        )
        if (far < ringMin) ringMin = far
      }
      const prominence = Math.max(0, h - ring / 8)
      // Any biome is fine: only steepness, summits, perched spots and water count.
      const cost =
        (hi - lo) * 1.0 +
        prominence * 0.4 +
        (h - ringMin) * 0.15 +
        (lo < ROAD_MIN_HEIGHT ? 200 : 0) +
        Math.abs(off) * 0.01
      if (cost < bestCost) {
        bestCost = cost
        best = x
      }
    }
    this.waypoints.set(k, best)
    return best
  }

  /** A* path from waypoint k to waypoint k + 1, resampled every ~SAMPLE_STEP meters. */
  private rawPath(k: number): RawPath {
    const cached = this.raws.get(k)
    if (cached) return cached
    const xa = this.waypoint(k)
    const xb = this.waypoint(k + 1)
    const iMin = Math.floor((Math.min(xa, xb) - CORRIDOR_MARGIN) / GRID)
    const iMax = Math.ceil((Math.max(xa, xb) + CORRIDOR_MARGIN) / GRID)
    const cols = iMax - iMin + 1
    const rows = ROWS + 1
    const count = cols * rows
    const z0 = -k * BAND_LENGTH
    const heights = new Float32Array(count).fill(Number.NaN)
    // A* state = (node, arrival move): turns are limited and cost, so the road cannot zigzag.
    const states = count * DIRS
    const g = new Float64Array(states).fill(Infinity)
    const came = new Int32Array(states).fill(-1)
    const closed = new Uint8Array(states)
    const nodeH = (i: number): number => {
      let v = heights[i] as number
      if (Number.isNaN(v)) {
        v = this.rawHeight((iMin + (i % cols)) * GRID, z0 - Math.floor(i / cols) * GRID)
        heights[i] = v
      }
      return v
    }
    // Height above the mean of 4 points 128 m away: high on summits and crests, ~0 on slopes
    // and passes. The road may climb mountainsides but never goes over a summit.
    const proms = new Float32Array(count).fill(Number.NaN)
    const prominence = (i: number): number => {
      let v = proms[i] as number
      if (Number.isNaN(v)) {
        const c = i % cols
        const r = (i - c) / cols
        const e = (cc: number, rr: number) =>
          Math.max(
            WATER_LEVEL,
            nodeH(Math.min(rows - 1, Math.max(0, rr)) * cols + Math.min(cols - 1, Math.max(0, cc))),
          )
        const ring =
          e(c - PROMINENCE_CELLS, r) +
          e(c + PROMINENCE_CELLS, r) +
          e(c, r - PROMINENCE_CELLS) +
          e(c, r + PROMINENCE_CELLS)
        v = Math.max(0, Math.max(WATER_LEVEL, nodeH(i)) - ring / 4)
        proms[i] = v
      }
      return v
    }
    const startNode = xa / GRID - iMin
    const goalNode = ROWS * cols + (xb / GRID - iMin)
    const gx = goalNode % cols
    const gr = ROWS
    const heap = new Heap()
    // Leave and reach waypoints heading north: bands join smoothly.
    const startState = startNode * DIRS + NORTH
    g[startState] = 0
    heap.push(startState, 0)
    let found = -1
    while (heap.size > 0) {
      const cur = heap.pop()
      if (closed[cur]) continue
      closed[cur] = 1
      const node = Math.floor(cur / DIRS)
      const dir = cur - node * DIRS
      if (node === goalNode && TURN_OK[dir * DIRS + NORTH]) {
        found = cur
        break
      }
      const cc = node % cols
      const cr = (node - cc) / cols
      const hc = Math.max(WATER_LEVEL, nodeH(node))
      const gc = g[cur] as number
      for (let m = 0; m < DIRS; m++) {
        if (!TURN_OK[dir * DIRS + m]) continue
        const nc = cc + (MOVES[m * 2] as number)
        const nr = cr + (MOVES[m * 2 + 1] as number)
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue
        const nb = nr * cols + nc
        const ns = nb * DIRS + m
        if (closed[ns]) continue
        const hw = nodeH(nb)
        // Over water the road is a bridge at the water line: grade measured from there.
        const hn = Math.max(WATER_LEVEL, hw)
        const d = MOVE_LEN[m] as number
        const grade = Math.abs(hn - hc) / d
        const wx = (iMin + nc) * GRID
        const wz = z0 - nr * GRID
        const soft = grade / SOFT_GRADE
        let mult =
          1 +
          0.5 * soft * soft +
          prominence(nb) * PROMINENCE_COST +
          0.6 * (this.wiggle(wx / 220, wz / 220) * 0.5 + 0.5)
        if (grade > MAX_GRADE) mult += (grade - MAX_GRADE) * 600
        if (hw < BRIDGE_BELOW) mult += WATER_COST
        const ng = gc + d * mult + (TURN_COST[dir * DIRS + m] as number)
        if (ng < (g[ns] as number)) {
          g[ns] = ng
          came[ns] = cur
          // Euclidean heuristic: admissible since every edge costs at least its length.
          heap.push(ns, ng + GRID * Math.hypot(nc - gx, nr - gr))
        }
      }
    }

    // Grid path, start to goal (straight line if the corridor had no path at all).
    const px: number[] = []
    const pz: number[] = []
    if (found < 0) {
      px.push(xa, xb)
      pz.push(z0, z0 - BAND_LENGTH)
    } else {
      const nodes: number[] = []
      for (let s = found; s !== -1; s = came[s] as number) nodes.push(Math.floor(s / DIRS))
      nodes.reverse()
      for (const n of nodes) {
        px.push((iMin + (n % cols)) * GRID)
        pz.push(z0 - Math.floor(n / cols) * GRID)
      }
    }
    const path = resample(px, pz, SAMPLE_STEP)
    this.raws.set(k, path)
    if (this.raws.size > 48) this.raws.delete(this.raws.keys().next().value as number)
    if (this.waypoints.size > 96)
      this.waypoints.delete(this.waypoints.keys().next().value as number)
    return path
  }

  /** Final road of band k: smoothed positions, profile and tangents. */
  band(k: number): RoadBandData {
    // Exactly CONTEXT samples before and after the band's own samples, from as many neighbor
    // bands as needed. Shared waypoints appear once.
    const cur = this.rawPath(k)
    const cn = cur.x.length
    const bx: number[] = []
    const bz: number[] = []
    for (let j = k - 1; bx.length < CONTEXT; j--) {
      const p = this.rawPath(j)
      for (let i = p.x.length - 2; i >= 0 && bx.length < CONTEXT; i--) {
        bx.push(p.x[i] as number)
        bz.push(p.z[i] as number)
      }
    }
    const ax: number[] = []
    const az: number[] = []
    for (let j = k + 1; ax.length < CONTEXT; j++) {
      const p = this.rawPath(j)
      for (let i = 1; i < p.x.length && ax.length < CONTEXT; i++) {
        ax.push(p.x[i] as number)
        az.push(p.z[i] as number)
      }
    }
    const off = CONTEXT
    const total = off + cn + CONTEXT
    const X = new Float64Array(total)
    const Z = new Float64Array(total)
    for (let i = 0; i < CONTEXT; i++) {
      X[off - 1 - i] = bx[i] as number
      Z[off - 1 - i] = bz[i] as number
      X[off + cn + i] = ax[i] as number
      Z[off + cn + i] = az[i] as number
    }
    for (let i = 0; i < cn; i++) {
      X[off + i] = cur.x[i] as number
      Z[off + i] = cur.z[i] as number
    }
    const sx = blurPasses(X, POS_RADIUS, POS_PASSES)
    const sz = blurPasses(Z, POS_RADIUS, POS_PASSES)
    // Bridges: over water (plus abutments), the profile targets the deck height.
    const wet = new Uint8Array(total)
    const raw = new Float64Array(total)
    for (let i = 0; i < total; i++) {
      raw[i] = this.rawHeight(sx[i] as number, sz[i] as number)
      wet[i] = (raw[i] as number) < BRIDGE_BELOW ? 1 : 0
    }
    const bridge = new Uint8Array(total)
    for (let i = 0; i < total; i++) {
      if (!wet[i]) continue
      for (let j = Math.max(0, i - BRIDGE_PAD); j <= Math.min(total - 1, i + BRIDGE_PAD); j++) {
        bridge[j] = 1
      }
    }
    const H = new Float64Array(total)
    for (let i = 0; i < total; i++) {
      H[i] = bridge[i]
        ? Math.max(raw[i] as number, WATER_LEVEL + BRIDGE_CLEARANCE)
        : Math.max(ROAD_MIN_HEIGHT, raw[i] as number)
    }
    const seg = new Float64Array(total)
    for (let i = 0; i < total - 1; i++) {
      seg[i] = Math.hypot(
        (sx[i + 1] as number) - (sx[i] as number),
        (sz[i + 1] as number) - (sz[i] as number),
      )
    }
    let sh = H
    let tmp = new Float64Array(total)
    for (let p = 0; p < H_PASSES; p++) {
      blurArc(sh, tmp, seg, H_ARC, H_RADIUS)
      const t = sh
      sh = tmp
      tmp = t
    }
    limitGrade(sh, tmp, seg, PROFILE_GRADE, GRADE_RADIUS)
    // Final pass rounds the grade changes left by the limiter (a blur keeps the grade limit).
    blurArc(tmp, sh, seg, H_ARC, H_RADIUS)

    const out: RoadBandData = {
      x: sx.slice(off, off + cn),
      z: sz.slice(off, off + cn),
      h: sh.slice(off, off + cn),
      dx: new Float32Array(cn),
      dz: new Float32Array(cn),
      bridge: bridge.slice(off, off + cn),
    }
    for (let i = 0; i < cn; i++) {
      const a = Math.max(0, off + i - 1)
      const b = Math.min(total - 1, off + i + 1)
      const tx = (sx[b] as number) - (sx[a] as number)
      const tz = (sz[b] as number) - (sz[a] as number)
      const len = Math.hypot(tx, tz) || 1
      out.dx[i] = tx / len
      out.dz[i] = tz / len
    }
    return out
  }
}

/** Resamples a polyline at a uniform spacing close to `step`, keeping both end points. */
function resample(px: number[], pz: number[], step: number): RawPath {
  const segs = px.length - 1
  const cum = new Float64Array(segs + 1)
  for (let i = 0; i < segs; i++) {
    cum[i + 1] =
      (cum[i] as number) +
      Math.hypot(
        (px[i + 1] as number) - (px[i] as number),
        (pz[i + 1] as number) - (pz[i] as number),
      )
  }
  const len = cum[segs] as number
  const n = Math.max(1, Math.round(len / step))
  const x = new Float64Array(n + 1)
  const z = new Float64Array(n + 1)
  let s = 0
  for (let i = 0; i <= n; i++) {
    const d = (i / n) * len
    while (s < segs - 1 && (cum[s + 1] as number) < d) s++
    const a = cum[s] as number
    const t = segs === 0 ? 0 : Math.min(1, (d - a) / ((cum[s + 1] as number) - a || 1))
    x[i] = (px[s] as number) + ((px[s + 1] ?? px[s]) as number) * t - (px[s] as number) * t
    z[i] = (pz[s] as number) + ((pz[s + 1] ?? pz[s]) as number) * t - (pz[s] as number) * t
  }
  x[n] = px[segs] as number
  z[n] = pz[segs] as number
  return { x, z }
}
