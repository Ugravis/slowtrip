import { CHUNK_SIZE } from '../../world/constants'
import type { HeightSampler } from '../../world/terrain/heightSampler'
import { TERRAIN_SRGB, terrainBand } from '../../world/terrain/chunkMesh'
import { unpackChunkX, unpackChunkZ } from '../../world/terrain/TerrainSystem'

/** Pixels per tile edge (one tile = one terrain chunk). */
const TILE_PX = 32
const STEP = CHUNK_SIZE / TILE_PX
/** Max tiles generated per draw: bounds main-thread cost (~0.2 ms per tile). */
const TILE_BUDGET = 8
/** Tile cache size (32x32 canvases, ~4 KB each). */
const MAX_TILES = 2000
/** Unexplored area. */
const FOG = '#1c2430'
/** Explored, tile not generated yet. */
const PENDING = '#3b4a3a'

export interface MinimapView {
  /** World position shown at the viewport center (float64, not local). */
  centerX: number
  centerZ: number
  /** World position of the player. */
  playerX: number
  playerZ: number
  /** Heading in radians, forward = (-sin h, -cos h). */
  heading: number
  /** Meters per CSS pixel. */
  zoom: number
  /** Heading-up when true, north-up otherwise. */
  rotate: boolean
  /** Draws the "N" marker on a round rim (minimap only). */
  northMarker: boolean
}

export interface MinimapMarker {
  x: number
  z: number
  color: string
}

/**
 * Draws a top-down terrain map from the deterministic height function, only over chunks the
 * player has explored (loaded by the terrain system). Tiles are generated lazily (a few per
 * draw) and cached, so zooming out never generates new terrain. World coordinates stay in JS
 * doubles: canvas transforms only see offsets relative to the view center.
 */
export class MinimapRenderer {
  private readonly tiles = new Map<number, HTMLCanvasElement>()
  private readonly missing: { key: number; d: number }[] = []

  constructor(
    private readonly height: HeightSampler,
    private readonly explored: ReadonlySet<number>,
  ) {}

  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    dpr: number,
    view: MinimapView,
    markers: readonly MinimapMarker[],
    markerCount: number,
  ): void {
    const hw = width / 2
    const hh = height / 2
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = FOG
    ctx.fillRect(0, 0, width, height)

    ctx.save()
    ctx.translate(hw, hh)
    if (view.rotate) ctx.rotate(view.heading)
    const k = 1 / view.zoom
    ctx.scale(k, k)

    // Visible world radius (covers the corners when rotated).
    const r = Math.hypot(hw, hh) * view.zoom + CHUNK_SIZE
    const ox = view.centerX
    const oz = view.centerZ
    const pcx = view.playerX / CHUNK_SIZE
    const pcz = view.playerZ / CHUNK_SIZE
    this.missing.length = 0
    // One screen pixel of overlap hides antialiased seams between scaled tiles.
    const seam = CHUNK_SIZE + view.zoom
    ctx.imageSmoothingEnabled = view.zoom > STEP * 0.5
    // Iterate explored chunks, not the view rectangle: cost is bounded by exploration,
    // whatever the zoom.
    for (const key of this.explored) {
      const cx = unpackChunkX(key)
      const cz = unpackChunkZ(key)
      const x = cx * CHUNK_SIZE - ox
      const z = cz * CHUNK_SIZE - oz
      if (x > r || z > r || x + CHUNK_SIZE < -r || z + CHUNK_SIZE < -r) continue
      const tile = this.tiles.get(key)
      if (!tile) {
        ctx.fillStyle = PENDING
        ctx.fillRect(x, z, seam, seam)
        this.missing.push({ key, d: (cx + 0.5 - pcx) ** 2 + (cz + 0.5 - pcz) ** 2 })
        continue
      }
      // Touch for LRU order.
      this.tiles.delete(key)
      this.tiles.set(key, tile)
      ctx.drawImage(tile, x, z, seam, seam)
    }

    for (let i = 0; i < markerCount; i++) {
      const m = markers[i] as MinimapMarker
      ctx.fillStyle = m.color
      ctx.beginPath()
      ctx.arc(m.x - ox, m.z - oz, 4 * view.zoom, 0, Math.PI * 2)
      ctx.fill()
    }

    // Player arrow, constant screen size.
    ctx.translate(view.playerX - ox, view.playerZ - oz)
    ctx.scale(view.zoom, view.zoom)
    ctx.rotate(-view.heading)
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = 'rgb(0 0 0 / 60%)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(0, -8)
    ctx.lineTo(6, 6)
    ctx.lineTo(0, 3)
    ctx.lineTo(-6, 6)
    ctx.closePath()
    ctx.stroke()
    ctx.fill()
    ctx.restore()

    if (view.northMarker) {
      ctx.save()
      ctx.translate(hw, hh)
      if (view.rotate) ctx.rotate(view.heading)
      ctx.fillStyle = '#fff'
      ctx.font = '600 11px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('N', 0, -hh + 9)
      ctx.restore()
    }

    this.generateMissing()
  }

  private generateMissing(): void {
    if (this.missing.length === 0) return
    this.missing.sort((a, b) => a.d - b.d)
    const n = Math.min(TILE_BUDGET, this.missing.length)
    for (let i = 0; i < n; i++) {
      const { key } = this.missing[i] as { key: number }
      this.tiles.set(key, this.buildTile(unpackChunkX(key), unpackChunkZ(key)))
    }
    while (this.tiles.size > MAX_TILES) {
      const oldest = this.tiles.keys().next().value
      if (oldest === undefined) break
      this.tiles.delete(oldest)
    }
  }

  private buildTile(cx: number, cz: number): HTMLCanvasElement {
    const n = TILE_PX
    const g = n + 1
    const h = new Float32Array(g * g)
    const ox = cx * CHUNK_SIZE
    const oz = cz * CHUNK_SIZE
    for (let j = 0; j < g; j++) {
      for (let i = 0; i < g; i++) h[j * g + i] = this.height(ox + i * STEP, oz + j * STEP)
    }

    const canvas = document.createElement('canvas')
    canvas.width = n
    canvas.height = n
    const ctx = canvas.getContext('2d')
    if (!ctx) return canvas
    const img = ctx.createImageData(n, n)
    const px = img.data
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h00 = h[j * g + i] as number
        const h10 = h[j * g + i + 1] as number
        const h01 = h[(j + 1) * g + i] as number
        const h11 = h[(j + 1) * g + i + 1] as number
        const y = (h00 + h10 + h01 + h11) / 4
        const gx = (h10 + h11 - h00 - h01) / (2 * STEP)
        const gz = (h01 + h11 - h00 - h10) / (2 * STEP)
        const ny = 1 / Math.sqrt(1 + gx * gx + gz * gz)
        const c = TERRAIN_SRGB[terrainBand(y, ny)]
        // Hillshade lit from the north-west, plus a slight height tint.
        const lit = Math.max(-1, Math.min(1, (gx + gz) * 0.9))
        const shade = 0.86 + 0.3 * lit + Math.max(-0.08, Math.min(0.08, y * 0.002))
        const o = (j * n + i) * 4
        px[o] = Math.min(255, c[0] * shade * 255)
        px[o + 1] = Math.min(255, c[1] * shade * 255)
        px[o + 2] = Math.min(255, c[2] * shade * 255)
        px[o + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    return canvas
  }
}
