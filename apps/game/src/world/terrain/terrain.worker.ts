import { expose, transfer } from 'comlink'
import { renderOverview, type OverviewArea } from '../road/overview'
import { buildChunkMesh, chunkBridgeSegments, sampleChunkHeights } from './chunkMesh'
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
  /** Physics data of a chunk: heightfield plus bridge deck segments. */
  collider(cx: number, cz: number, res: number) {
    const heights = sampleChunkHeights(gen().height, cx, cz, res)
    const bridges = chunkBridgeSegments(gen(), cx, cz)
    return transfer({ heights, bridges }, [heights.buffer, bridges.buffer])
  },
  /** Map tile as a transferable bitmap: the main thread only draws it. */
  async mapTile(cx: number, cz: number, layer: MapLayer) {
    const px = mapTilePixels(gen(), cx, cz, layer)
    const bitmap = await createImageBitmap(new ImageData(px, MAP_TILE_PX, MAP_TILE_PX))
    return transfer(bitmap, [bitmap])
  },
  /** Final road band k, for the main thread's copy of the road network. */
  roadBand(k: number) {
    const d = gen().roads.compute(k)
    return transfer(d, [
      d.x.buffer,
      d.z.buffer,
      d.h.buffer,
      d.dx.buffer,
      d.dz.buffer,
      d.bridge.buffer,
    ])
  },
  /** Dev: world and road overview of an area, as a transferable bitmap. */
  async overview(area: OverviewArea) {
    const img = renderOverview(gen(), area)
    const px = new Uint8ClampedArray(img.width * img.height * 4)
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
      px[i] = img.rgb[j] as number
      px[i + 1] = img.rgb[j + 1] as number
      px[i + 2] = img.rgb[j + 2] as number
      px[i + 3] = 255
    }
    const bitmap = await createImageBitmap(new ImageData(px, img.width, img.height))
    return transfer({ bitmap, x0: img.x0, z0: img.z0, scale: img.scale }, [bitmap])
  },
  /** Peaks and passes of a feature region (map markers). */
  mapFeatures(rx: number, rz: number) {
    return regionFeatures(gen().height, rx, rz)
  },
}

export type TerrainWorkerApi = typeof api

expose(api)
