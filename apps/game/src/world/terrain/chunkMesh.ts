import { hash2 } from '../../core/rng'
import { CHUNK_SIZE } from '../constants'
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

  const triCount = res * res * 2 + res * 4 * 2
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
    faceColor(colors, p, (ay + by + qy) / 3, ny, wv, wa, wl, jitter)
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

  return { positions, normals, colors, minY: minY - skirtDepth, maxY }
}
