import { hash2 } from '../../core/rng'
import { CHUNK_SIZE } from '../constants'
import { bandOf, ROAD_HALF_WIDTH, type RoadBand } from '../road/roadNetwork'
import { terrainColor } from './biomes'
import { createTerrainPoint, type HeightSampler, type WorldGen } from './heightSampler'

export interface ChunkMeshData {
  /** Non-indexed triangle positions, local to the chunk center. */
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
  minY: number
  maxY: number
}

/**
 * Samples a (res + 1)² height grid for chunk (cx, cz).
 * Column-major (x-major) layout, as expected by Rapier heightfields:
 * index = ix * (res + 1) + iz.
 */
export function sampleChunkHeights(
  sample: HeightSampler,
  cx: number,
  cz: number,
  res: number,
): Float32Array {
  const n = res + 1
  const step = CHUNK_SIZE / res
  const x0 = cx * CHUNK_SIZE
  const z0 = cz * CHUNK_SIZE
  const heights = new Float32Array(n * n)
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      heights[ix * n + iz] = sample(x0 + ix * step, z0 + iz * step)
    }
  }
  return heights
}

/** Scratch sRGB color for face shading. */
const _rgb = new Float32Array(3)

/** Road surface colors (linear). */
const lin = (r: number, g: number, b: number) => new Float32Array([r ** 2.2, g ** 2.2, b ** 2.2])
const ASPHALT = lin(0.22, 0.22, 0.24)
const MARKING = lin(0.86, 0.86, 0.82)
const CONCRETE = lin(0.62, 0.6, 0.56)
/** Bridge deck thickness, parapet height and width, pier half size, pier spacing (samples). */
const DECK_T = 0.9
const PARAPET_H = 0.9
const PARAPET_W = 0.35
const PIER_HALF = 0.8
const PIER_EVERY = 6
/** Road strips: lateral offsets (m from the centerline, + = right), lift above the asphalt, color, dashed. */
const ROAD_STRIPS: readonly (readonly [number, number, number, Float32Array, boolean])[] = [
  [-ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, 0, ASPHALT, false],
  [-ROAD_HALF_WIDTH + 0.25, -ROAD_HALF_WIDTH + 0.4, 0.02, MARKING, false],
  [ROAD_HALF_WIDTH - 0.4, ROAD_HALF_WIDTH - 0.25, 0.02, MARKING, false],
  [-0.075, 0.075, 0.02, MARKING, true],
]
const W = ROAD_HALF_WIDTH
const E = ROAD_HALF_WIDTH + PARAPET_W
/**
 * Bridge cross-section edges (lateral, height relative to the road surface). Each edge P0 -> P1
 * is extruded along the road; its outward normal is P1 - P0 rotated a quarter turn counter-clockwise.
 */
const BRIDGE_EDGES: readonly (readonly [number, number, number, number])[] = [
  [-E, PARAPET_H, -W, PARAPET_H],
  [-W, PARAPET_H, -W, 0],
  [-E, -DECK_T, -E, PARAPET_H],
  [W, PARAPET_H, E, PARAPET_H],
  [W, 0, W, PARAPET_H],
  [E, PARAPET_H, E, -DECK_T],
  [E, -DECK_T, -E, -DECK_T],
]
/** Deck end cap rectangles (lateral and height ranges): deck slab, then both parapets. */
const BRIDGE_CAPS: readonly (readonly [number, number, number, number])[] = [
  [-E, -DECK_T, E, 0],
  [-E, 0, -W, PARAPET_H],
  [W, 0, E, PARAPET_H],
]
/** Upper bound of road triangles per segment: strips, bridge sides, two end caps, one pier. */
const ROAD_TRIS_PER_SEGMENT =
  ROAD_STRIPS.length * 2 + BRIDGE_EDGES.length * 2 + BRIDGE_CAPS.length * 4 + 8

/**
 * Bridge deck segments of chunk (cx, cz) for physics: [ax, ay, az, bx, by, bz] per segment,
 * road surface centerline relative to the chunk center.
 */
export function chunkBridgeSegments(gen: WorldGen, cx: number, cz: number): Float32Array {
  const cxw = (cx + 0.5) * CHUNK_SIZE
  const czw = (cz + 0.5) * CHUNK_SIZE
  const out: number[] = []
  for (const [band, i] of chunkRoadSegments(gen, cx, cz)) {
    const { x, z, h, bridge } = band.data
    if (bridge[i] !== 1 || bridge[i + 1] !== 1) continue
    out.push(
      (x[i] as number) - cxw,
      h[i] as number,
      (z[i] as number) - czw,
      (x[i + 1] as number) - cxw,
      h[i + 1] as number,
      (z[i + 1] as number) - czw,
    )
  }
  return Float32Array.from(out)
}

/** Road lift above the leveled terrain, by mesh resolution: coarse LODs sag below the road. */
const roadLift = (res: number) => (res >= 32 ? 0.06 : res >= 16 ? 0.3 : res >= 8 ? 0.9 : 2)

/** Road segments (band, first sample index) whose midpoint lies in chunk (cx, cz). */
function chunkRoadSegments(gen: WorldGen, cx: number, cz: number): [RoadBand, number][] {
  const x0 = cx * CHUNK_SIZE
  const z0 = cz * CHUNK_SIZE
  const out: [RoadBand, number][] = []
  // Smoothing keeps samples within a few meters of their band.
  for (let k = bandOf(z0 + CHUNK_SIZE + 64); k <= bandOf(z0 - 64); k++) {
    const band = gen.roads.band(k)
    if (!band) continue
    const { x, z } = band.data
    for (let i = 0; i < band.count - 1; i++) {
      const mx = ((x[i] as number) + (x[i + 1] as number)) * 0.5
      const mz = ((z[i] as number) + (z[i + 1] as number)) * 0.5
      if (mx >= x0 && mx < x0 + CHUNK_SIZE && mz >= z0 && mz < z0 + CHUNK_SIZE) out.push([band, i])
    }
  }
  return out
}

function faceColor(
  out: Float32Array,
  offset: number,
  y: number,
  ny: number,
  valley: number,
  alpine: number,
  lake: number,
  jitter: number,
): void {
  terrainColor(_rgb, 0, y, ny, valley, 1 - valley - alpine - lake, alpine, lake)
  // sRGB to linear (vertex colors are linear), with a slight per-face brightness variation.
  const k = 0.96 + jitter * 0.08
  const r = (_rgb[0] as number) ** 2.2 * k
  const g = (_rgb[1] as number) ** 2.2 * k
  const b = (_rgb[2] as number) ** 2.2 * k
  for (let v = 0; v < 3; v++) {
    const o = offset + v * 3
    out[o] = r
    out[o + 1] = g
    out[o + 2] = b
  }
}

/**
 * Builds a flat-shaded chunk mesh at `res` cells per edge, with skirts hiding LOD cracks.
 * Pure and deterministic: depends only on (world seed, cx, cz, res).
 */
export function buildChunkMesh(
  gen: WorldGen,
  seed: number,
  cx: number,
  cz: number,
  res: number,
  skirtDepth: number,
): ChunkMeshData {
  const n = res + 1
  const step = CHUNK_SIZE / res
  const half = CHUNK_SIZE / 2
  const x0w = cx * CHUNK_SIZE
  const z0w = cz * CHUNK_SIZE
  // Heights and biome weights per vertex (x-major, like sampleChunkHeights).
  const heights = new Float32Array(n * n)
  const valleyW = new Float32Array(n * n)
  const alpineW = new Float32Array(n * n)
  const lakeW = new Float32Array(n * n)
  const pt = createTerrainPoint()
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      gen.sample(x0w + ix * step, z0w + iz * step, pt)
      const i = ix * n + iz
      heights[i] = pt.height
      valleyW[i] = pt.valley
      alpineW[i] = pt.alpine
      lakeW[i] = pt.lake
    }
  }

  const road = chunkRoadSegments(gen, cx, cz)
  const triCount = res * res * 2 + res * 4 * 2 + road.length * ROAD_TRIS_PER_SEGMENT
  const positions = new Float32Array(triCount * 9)
  const normals = new Float32Array(triCount * 9)
  const colors = new Float32Array(triCount * 9)
  let p = 0
  let minY = Infinity
  let maxY = -Infinity

  const h = (ix: number, iz: number) => heights[ix * n + iz] as number
  // Biome weights of the current cell (or border vertex for skirts).
  let wv = 0
  let wa = 0
  let wl = 0
  const setWeights = (ix: number, iz: number) => {
    wv = valleyW[ix * n + iz] as number
    wa = alpineW[ix * n + iz] as number
    wl = lakeW[ix * n + iz] as number
  }

  // Flat color override (road), null for terrain shading.
  let flat: Float32Array | null = null
  const tri = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    qx: number,
    qy: number,
    qz: number,
    jitter: number,
  ) => {
    // Face normal = (b - a) x (c - a)
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az
    const vx = qx - ax,
      vy = qy - ay,
      vz = qz - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len
    positions[p] = ax
    positions[p + 1] = ay
    positions[p + 2] = az
    positions[p + 3] = bx
    positions[p + 4] = by
    positions[p + 5] = bz
    positions[p + 6] = qx
    positions[p + 7] = qy
    positions[p + 8] = qz
    for (let v = 0; v < 9; v += 3) {
      normals[p + v] = nx
      normals[p + v + 1] = ny
      normals[p + v + 2] = nz
    }
    if (flat) {
      for (let v = 0; v < 9; v += 3) {
        colors[p + v] = flat[0] as number
        colors[p + v + 1] = flat[1] as number
        colors[p + v + 2] = flat[2] as number
      }
    } else faceColor(colors, p, (ay + by + qy) / 3, ny, wv, wa, wl, jitter)
    p += 9
  }

  for (let ix = 0; ix < res; ix++) {
    for (let iz = 0; iz < res; iz++) {
      const x0 = ix * step - half
      const z0 = iz * step - half
      const x1 = x0 + step
      const z1 = z0 + step
      const h00 = h(ix, iz),
        h10 = h(ix + 1, iz),
        h01 = h(ix, iz + 1),
        h11 = h(ix + 1, iz + 1)
      const j = hash2(seed, cx * 4096 + ix, cz * 4096 + iz)
      // Cell-average biome weights: both triangles share them.
      const c00 = ix * n + iz
      const c11 = (ix + 1) * n + iz + 1
      wv = ((valleyW[c00] as number) + (valleyW[c11] as number)) * 0.5
      wa = ((alpineW[c00] as number) + (alpineW[c11] as number)) * 0.5
      wl = ((lakeW[c00] as number) + (lakeW[c11] as number)) * 0.5
      // Counter-clockwise seen from above (+Y normal).
      tri(x0, h00, z0, x0, h01, z1, x1, h10, z0, j)
      tri(x1, h10, z0, x0, h01, z1, x1, h11, z1, (j * 7.31) % 1)
      const lo = Math.min(h00, h10, h01, h11)
      const hi = Math.max(h00, h10, h01, h11)
      if (lo < minY) minY = lo
      if (hi > maxY) maxY = hi
    }
  }

  // Skirts: vertical strips below each border edge.
  for (let i = 0; i < res; i++) {
    const a = i * step - half
    const b = a + step
    // -Z edge (iz = 0), normal -Z
    {
      setWeights(i, 0)
      const ha = h(i, 0),
        hb = h(i + 1, 0)
      tri(a, ha, -half, b, hb, -half, a, ha - skirtDepth, -half, 0.5)
      tri(b, hb, -half, b, hb - skirtDepth, -half, a, ha - skirtDepth, -half, 0.5)
    }
    // +Z edge (iz = res), normal +Z
    {
      setWeights(i, res)
      const ha = h(i, res),
        hb = h(i + 1, res)
      tri(a, ha, half, a, ha - skirtDepth, half, b, hb, half, 0.5)
      tri(b, hb, half, a, ha - skirtDepth, half, b, hb - skirtDepth, half, 0.5)
    }
    // -X edge (ix = 0), normal -X
    {
      setWeights(0, i)
      const ha = h(0, i),
        hb = h(0, i + 1)
      tri(-half, ha, a, -half, ha - skirtDepth, a, -half, hb, b, 0.5)
      tri(-half, hb, b, -half, ha - skirtDepth, a, -half, hb - skirtDepth, b, 0.5)
    }
    // +X edge (ix = res), normal +X
    {
      setWeights(res, i)
      const ha = h(res, i),
        hb = h(res, i + 1)
      tri(half, ha, a, half, hb, b, half, ha - skirtDepth, a, 0.5)
      tri(half, hb, b, half, hb - skirtDepth, b, half, ha - skirtDepth, a, 0.5)
    }
  }

  // Road strips over the leveled terrain, chunk-local coordinates.
  const cxw = x0w + half
  const czw = z0w + half
  const lift = roadLift(res)
  // Triangle with its normal flipped, if needed, to face (nx, ny, nz).
  const triOut = (
    a: readonly number[],
    b: readonly number[],
    c: readonly number[],
    nx: number,
    ny: number,
    nz: number,
  ) => {
    const ux = (b[0] as number) - (a[0] as number)
    const uy = (b[1] as number) - (a[1] as number)
    const uz = (b[2] as number) - (a[2] as number)
    const vx = (c[0] as number) - (a[0] as number)
    const vy = (c[1] as number) - (a[1] as number)
    const vz = (c[2] as number) - (a[2] as number)
    const dot = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz
    const [p, q] = dot >= 0 ? [b, c] : [c, b]
    tri(
      a[0] as number,
      a[1] as number,
      a[2] as number,
      p[0] as number,
      p[1] as number,
      p[2] as number,
      q[0] as number,
      q[1] as number,
      q[2] as number,
      0,
    )
  }
  for (const [band, i] of road) {
    const { x, z, h, dx, dz, bridge } = band.data
    const onBridge = bridge[i] === 1 && bridge[i + 1] === 1
    const ax = (x[i] as number) - cxw
    const az = (z[i] as number) - czw
    const bx = (x[i + 1] as number) - cxw
    const bz = (z[i + 1] as number) - czw
    // No terrain under a bridge deck: no lift needed.
    // Approach embankments reach under the deck ends: same lift as on land.
    const ay = (h[i] as number) + lift
    const by = (h[i + 1] as number) + lift
    // Right vector = (-dz, dx) for a tangent (dx, dz).
    const arx = -(dz[i] as number)
    const arz = dx[i] as number
    const brx = -(dz[i + 1] as number)
    const brz = dx[i + 1] as number
    for (const [l, r, dy, color, dashed] of ROAD_STRIPS) {
      if (dashed && (i & 2) !== 0) continue
      flat = color
      const lax = ax + arx * l
      const laz = az + arz * l
      const rax = ax + arx * r
      const raz = az + arz * r
      const lbx = bx + brx * l
      const lbz = bz + brz * l
      const rbx = bx + brx * r
      const rbz = bz + brz * r
      // Counter-clockwise seen from above.
      tri(lax, ay + dy, laz, rax, ay + dy, raz, lbx, by + dy, lbz, 0)
      tri(rax, ay + dy, raz, rbx, by + dy, rbz, lbx, by + dy, lbz, 0)
    }
    if (onBridge) {
      flat = CONCRETE
      for (const [l0, y0, l1, y1] of BRIDGE_EDGES) {
        // Outward normal in the cross-section plane (lateral, up): edge rotated a quarter turn.
        const nl = y0 - y1
        const nu = l1 - l0
        const p0a = [ax + arx * l0, ay + y0, az + arz * l0]
        const p1a = [ax + arx * l1, ay + y1, az + arz * l1]
        const p0b = [bx + brx * l0, by + y0, bz + brz * l0]
        const p1b = [bx + brx * l1, by + y1, bz + brz * l1]
        const nx = arx * nl
        const nz = arz * nl
        triOut(p0a, p1a, p0b, nx, nu, nz)
        triOut(p1a, p1b, p0b, nx, nu, nz)
      }
      // End caps where the deck starts or stops (not at band joints, where it continues).
      for (const [end, px, py, pz, sign] of [
        [i > 0 && bridge[i - 1] === 0, ax, ay, az, -1],
        [i + 2 < band.count && bridge[i + 2] === 0, bx, by, bz, 1],
      ] as const) {
        if (!end) continue
        const rx = sign < 0 ? arx : brx
        const rz = sign < 0 ? arz : brz
        const tx = (sign < 0 ? (dx[i] as number) : (dx[i + 1] as number)) * sign
        const tz = (sign < 0 ? (dz[i] as number) : (dz[i + 1] as number)) * sign
        for (const [l0, y0, l1, y1] of BRIDGE_CAPS) {
          const c00 = [px + rx * l0, py + y0, pz + rz * l0]
          const c10 = [px + rx * l1, py + y0, pz + rz * l1]
          const c11 = [px + rx * l1, py + y1, pz + rz * l1]
          const c01 = [px + rx * l0, py + y1, pz + rz * l0]
          triOut(c00, c10, c11, tx, 0, tz)
          triOut(c00, c11, c01, tx, 0, tz)
        }
      }
      if (i % PIER_EVERY === 0) {
        const top = ay - DECK_T
        const bottom = gen.height(x[i] as number, z[i] as number) - 1
        if (bottom < top) {
          const s = PIER_HALF
          for (const [fx, fz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            // Face centered at (ax + fx s, az + fz s), spanning the other axis.
            const cxp = ax + fx * s
            const czp = az + fz * s
            const ex = fz * s
            const ez = fx * s
            const p = [cxp - ex, top, czp - ez]
            const q = [cxp + ex, top, czp + ez]
            const r = [cxp + ex, bottom, czp + ez]
            const t = [cxp - ex, bottom, czp - ez]
            triOut(p, q, r, fx, 0, fz)
            triOut(p, r, t, fx, 0, fz)
          }
          if (bottom < minY) minY = bottom
        }
      }
      if (ay + PARAPET_H > maxY) maxY = ay + PARAPET_H
    }
    flat = null
    if (ay < minY) minY = ay
    if (by > maxY) maxY = by
  }

  return {
    positions: p === positions.length ? positions : positions.slice(0, p),
    normals: p === normals.length ? normals : normals.slice(0, p),
    colors: p === colors.length ? colors : colors.slice(0, p),
    minY: minY - skirtDepth,
    maxY,
  }
}
