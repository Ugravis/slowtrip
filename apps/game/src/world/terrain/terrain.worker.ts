import { expose, transfer } from 'comlink'
import { buildChunkMesh, sampleChunkHeights } from './chunkMesh'
import { createWorldGen, type WorldGen } from './heightSampler'
import { regionFeatures } from './mapFeatures'
import { MAP_TILE_PX, mapTilePixels, type MapLayer } from './mapTile'

let seed = 0
let world: WorldGen | null = null

function gen(): WorldGen {
  if (!world) throw new Error('Terrain worker not initialized')
  return world
}

const api = {
  init(worldSeed: number) {
    seed = worldSeed
    world = createWorldGen(worldSeed)
  },
  mesh(cx: number, cz: number, res: number, skirtDepth: number) {
    const data = buildChunkMesh(gen(), seed, cx, cz, res, skirtDepth)
    return transfer(data, [data.positions.buffer, data.normals.buffer, data.colors.buffer])
  },
  heights(cx: number, cz: number, res: number) {
    const heights = sampleChunkHeights(gen().height, cx, cz, res)
    return transfer(heights, [heights.buffer])
  },
  /** Map tile as a transferable bitmap: the main thread only draws it. */
  async mapTile(cx: number, cz: number, layer: MapLayer) {
    const px = mapTilePixels(gen(), cx, cz, layer)
    const bitmap = await createImageBitmap(new ImageData(px, MAP_TILE_PX, MAP_TILE_PX))
    return transfer(bitmap, [bitmap])
  },
  /** Peaks and passes of a feature region (map markers). */
  mapFeatures(rx: number, rz: number) {
    return regionFeatures(gen().height, rx, rz)
  },
}

export type TerrainWorkerApi = typeof api

expose(api)
