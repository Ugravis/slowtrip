import { CHUNK_SIZE } from '../constants'
import type { HeightSampler } from './heightSampler'

export type MapFeatureKind = 'peak' | 'pass'

export interface MapFeature {
  kind: MapFeatureKind
  /** World position (m). */
  x: number
  z: number
  height: number
}

/** Features are detected per square region of this many chunks per edge. */
export const FEATURE_REGION = 8

/** Detection lattice step (m). Global lattice: regions agree on shared points. */
const STEP = 16
/** A peak is the highest lattice point within this radius (cells, 240 m). */
const PEAK_RADIUS = 15
const PEAK_MIN_HEIGHT = 60
/** Minimum height of a peak above the mean of its surrounding ring (m). */
const PEAK_MIN_RISE = 25
/** Pass test ring radius (cells, 192 m) and direction count. */
const PASS_RING = 12
const PASS_DIRS = 16
/** Height difference (m) for a ring direction to count as rising or falling. */
const PASS_DELTA = 12
const PASS_MIN_HEIGHT = 40
/** Only the best pass candidate within this radius is kept (cells, 256 m). */
const PASS_SUPPRESS = 16
/** Lattice margin around the region so every test sees full neighborhoods. */
const MARGIN = PASS_RING + PASS_SUPPRESS

function disk(r: number): Int16Array {
  const out: number[] = []
  for (let di = -r; di <= r; di++) {
    for (let dj = -r; dj <= r; dj++) {
      if ((di !== 0 || dj !== 0) && di * di + dj * dj <= r * r) out.push(di, dj)
    }
  }
  return Int16Array.from(out)
}

function ring(r: number, count: number): Int16Array {
  const out = new Int16Array(count * 2)
  for (let d = 0; d < count; d++) {
    const a = (d / count) * Math.PI * 2
    out[d * 2] = Math.round(Math.cos(a) * r)
    out[d * 2 + 1] = Math.round(Math.sin(a) * r)
  }
  return out
}

const PEAK_DISK = disk(PEAK_RADIUS)
const PEAK_RING = ring(PEAK_RADIUS, 16)
const PASS_RING_OFFSETS = ring(PASS_RING, PASS_DIRS)
const PASS_DISK = disk(PASS_SUPPRESS)
/** Local saddle test: 8 neighbors at 2 cells (32 m), in circular order. */
const LOCAL_RING = ring(2, 8)

/** Strict total order on lattice points: higher value wins, ties broken by offset sign. */
const beats = (v: number, v0: number, di: number, dj: number) =>
  v > v0 || (v === v0 && (di < 0 || (di === 0 && dj < 0)))

/**
 * Peaks (summits) and passes (cols) whose lattice point lies in region (rx, rz).
 * Peaks: local maxima over 240 m that rise above their surroundings.
 * Passes: saddles, where a ring around the point alternates rising / falling at least twice
 * (two ridges, two valleys); among nearby candidates the most pronounced saddle wins.
 * Pure and deterministic: depends only on the height function and the region.
 */
export function regionFeatures(height: HeightSampler, rx: number, rz: number): MapFeature[] {
  const cells = (FEATURE_REGION * CHUNK_SIZE) / STEP
  const n = cells + MARGIN * 2
  const gi0 = rx * cells - MARGIN
  const gj0 = rz * cells - MARGIN
  const h = new Float32Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) h[i * n + j] = height((gi0 + i) * STEP, (gj0 + j) * STEP)
  }
  const at = (i: number, j: number) => h[i * n + j] as number
  const features: MapFeature[] = []
  const lo = MARGIN
  const hi = MARGIN + cells

  // Peaks.
  for (let i = lo; i < hi; i++) {
    for (let j = lo; j < hi; j++) {
      const h0 = at(i, j)
      if (h0 < PEAK_MIN_HEIGHT) continue
      let isMax = true
      for (let k = 0; k < PEAK_DISK.length; k += 2) {
        const di = PEAK_DISK[k] as number
        const dj = PEAK_DISK[k + 1] as number
        if (beats(at(i + di, j + dj), h0, di, dj)) {
          isMax = false
          break
        }
      }
      if (!isMax) continue
      let mean = 0
      for (let k = 0; k < PEAK_RING.length; k += 2) {
        mean += at(i + (PEAK_RING[k] as number), j + (PEAK_RING[k + 1] as number))
      }
      mean /= PEAK_RING.length / 2
      if (h0 - mean < PEAK_MIN_RISE) continue
      features.push({ kind: 'peak', x: (gi0 + i) * STEP, z: (gj0 + j) * STEP, height: h0 })
    }
  }

  // Pass scores over the region plus the suppression margin.
  const score = new Float32Array(n * n)
  const s0 = lo - PASS_SUPPRESS
  const s1 = hi + PASS_SUPPRESS
  for (let i = s0; i < s1; i++) {
    for (let j = s0; j < s1; j++) score[i * n + j] = passScore(at, i, j)
  }
  for (let i = lo; i < hi; i++) {
    for (let j = lo; j < hi; j++) {
      const s = score[i * n + j] as number
      if (s <= 0) continue
      let best = true
      for (let k = 0; k < PASS_DISK.length; k += 2) {
        const di = PASS_DISK[k] as number
        const dj = PASS_DISK[k + 1] as number
        if (beats(score[(i + di) * n + j + dj] as number, s, di, dj)) {
          best = false
          break
        }
      }
      if (best) {
        features.push({ kind: 'pass', x: (gi0 + i) * STEP, z: (gj0 + j) * STEP, height: at(i, j) })
      }
    }
  }
  return features
}

const _signs = new Int8Array(PASS_DIRS)
const _values = new Float32Array(PASS_DIRS)

/**
 * Saddle strength at (i, j): the smallest lobe relief on the large ring, or 0 if the point is not
 * a local saddle or the ring does not show two ridges and two valleys.
 */
function passScore(at: (i: number, j: number) => number, i: number, j: number): number {
  const h0 = at(i, j)
  if (h0 < PASS_MIN_HEIGHT) return 0
  // Local saddle: neighbors alternate above / below at least twice (on the crest line, at the
  // high point of the crossing). Without it, the strongest score drifts off the saddle.
  let changes = 0
  let prev = at(i + (LOCAL_RING[14] as number), j + (LOCAL_RING[15] as number)) > h0
  for (let d = 0; d < 8; d++) {
    const up = at(i + (LOCAL_RING[d * 2] as number), j + (LOCAL_RING[d * 2 + 1] as number)) > h0
    if (up !== prev) changes++
    prev = up
  }
  if (changes < 4) return 0
  // Ring directions clearly rising (+1) or falling (-1); flat ones are skipped.
  let m = 0
  for (let d = 0; d < PASS_DIRS; d++) {
    const v = at(
      i + (PASS_RING_OFFSETS[d * 2] as number),
      j + (PASS_RING_OFFSETS[d * 2 + 1] as number),
    )
    const c = v > h0 + PASS_DELTA ? 1 : v < h0 - PASS_DELTA ? -1 : 0
    if (c === 0) continue
    _signs[m] = c
    _values[m] = v
    m++
  }
  if (m < 4) return 0
  // Start on a sign change so that no lobe wraps around the end of the ring.
  let start = -1
  for (let k = 0; k < m; k++) {
    if (_signs[k] !== _signs[(k + m - 1) % m]) {
      start = k
      break
    }
  }
  if (start < 0) return 0
  // Lobes: runs of equal sign. Score = relief of the weakest lobe (ridge top or valley floor).
  let lobes = 0
  let weakest = Infinity
  let sign = 0
  let extreme = 0
  for (let t = 0; t <= m; t++) {
    const k = (start + t) % m
    const c = t === m ? 0 : (_signs[k] as number)
    const v = _values[k] as number
    if (c === sign) {
      extreme = c > 0 ? Math.max(extreme, v) : Math.min(extreme, v)
      continue
    }
    if (sign !== 0) weakest = Math.min(weakest, sign > 0 ? extreme - h0 : h0 - extreme)
    sign = c
    extreme = v
    lobes++
  }
  return lobes - 1 >= 4 ? weakest : 0
}
