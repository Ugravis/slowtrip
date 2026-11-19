import { wrap, type Remote } from 'comlink'
import type { OverviewArea } from '../road/overview'
import type { MapFeature } from './mapFeatures'
import type { MapLayer } from './mapTile'
import type { TerrainWorkerApi } from './terrain.worker'

/** Overview image placed in world space: top-left corner and meters per pixel. */
export interface MapOverview {
  bitmap: ImageBitmap
  x0: number
  z0: number
  scale: number
}

/**
 * Map tile generator on its own worker, so map tiles never delay terrain chunk meshes
 * and never cost main-thread time.
 */
export class MapTileSource {
  private readonly worker: Worker
  private readonly api: Remote<TerrainWorkerApi>
  private readonly ready: Promise<void>

  constructor(seed: number) {
    this.worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' })
    this.api = wrap<TerrainWorkerApi>(this.worker)
    this.ready = this.api.init(seed)
  }

  tile(cx: number, cz: number, layer: MapLayer): Promise<ImageBitmap> {
    return this.ready.then(() => this.api.mapTile(cx, cz, layer))
  }

  /** Dev: world and road overview image of an area. */
  overview(area: OverviewArea): Promise<MapOverview> {
    return this.ready.then(() => this.api.overview(area))
  }

  /** Peaks and passes of feature region (rx, rz). */
  features(rx: number, rz: number): Promise<MapFeature[]> {
    return this.ready.then(() => this.api.mapFeatures(rx, rz))
  }

  dispose(): void {
    this.worker.terminate()
  }
}
