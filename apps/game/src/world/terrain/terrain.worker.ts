import { expose, transfer } from 'comlink'
import { buildChunkMesh, sampleChunkHeights } from './chunkMesh'
import { createHeightSampler, type HeightSampler } from './heightSampler'

let seed = 0
let sample: HeightSampler | null = null

function sampler(): HeightSampler {
  if (!sample) throw new Error('Terrain worker not initialized')
  return sample
}

const api = {
  init(worldSeed: number) {
    seed = worldSeed
    sample = createHeightSampler(worldSeed)
  },
  mesh(cx: number, cz: number, res: number, skirtDepth: number) {
    const data = buildChunkMesh(sampler(), seed, cx, cz, res, skirtDepth)
    return transfer(data, [data.positions.buffer, data.normals.buffer, data.colors.buffer])
  },
  heights(cx: number, cz: number, res: number) {
    const heights = sampleChunkHeights(sampler(), cx, cz, res)
    return transfer(heights, [heights.buffer])
  },
}

export type TerrainWorkerApi = typeof api

expose(api)
