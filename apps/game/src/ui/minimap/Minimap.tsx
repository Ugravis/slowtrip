import { MinusIcon, PlusIcon } from 'lucide-react'
import { useEffect, useRef, type RefObject } from 'react'
import { MINIMAP_ZOOM_MAX, MINIMAP_ZOOM_MIN, useSettings } from '../../core/settings'
import type { Game, PlayerPose } from '../../game/Game'
import { MinimapRenderer, type MinimapMarker, type MinimapView } from './MinimapRenderer'

/** Redraw rate: the map moves slowly, 10 Hz is plenty and keeps main-thread cost low. */
const DRAW_MS = 100
const VEHICLE_COLOR = '#ffb347'

/** One renderer (and tile cache) per game, shared by the minimap and the full map. */
const renderers = new WeakMap<Game, MinimapRenderer>()
function rendererFor(game: Game): MinimapRenderer {
  let r = renderers.get(game)
  if (!r) {
    r = new MinimapRenderer(game.mapTiles, game.terrain.explored)
    renderers.set(game, r)
  }
  return r
}

export const clampZoom = (z: number, max = MINIMAP_ZOOM_MAX) =>
  Math.min(max, Math.max(MINIMAP_ZOOM_MIN, z))

/**
 * Starts drawing the map into `el` at 10 Hz. `frame()` returns the callback setting the view
 * center, zoom and rotation (player fields are filled before it runs).
 */
function startMapLoop(
  el: HTMLCanvasElement,
  game: Game,
  frame: () => (view: MinimapView) => void,
): { redraw: () => void; stop: () => void } {
  const ctx = el.getContext('2d')
  if (!ctx) return { redraw: () => {}, stop: () => {} }
  const renderer = rendererFor(game)
  const pose: PlayerPose = { x: 0, y: 0, z: 0, heading: 0 }
  const view: MinimapView = {
    centerX: 0,
    centerZ: 0,
    playerX: 0,
    playerZ: 0,
    heading: 0,
    zoom: 1,
    rotate: false,
    northMarker: false,
    layer: 'terrain',
    labels: false,
  }
  const markers: MinimapMarker[] = game.vehicles.entities.map(() => ({
    x: 0,
    z: 0,
    color: VEHICLE_COLOR,
  }))

  const draw = () => {
    const w = el.clientWidth
    const h = el.clientHeight
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const pw = Math.round(w * dpr)
    const ph = Math.round(h * dpr)
    if (el.width !== pw || el.height !== ph) {
      el.width = pw
      el.height = ph
    }
    game.pose(pose)
    view.playerX = view.centerX = pose.x
    view.playerZ = view.centerZ = pose.z
    view.heading = pose.heading
    frame()(view)
    let n = 0
    for (const { vehicle } of game.vehicles.entities) {
      // The driven vehicle is the player arrow.
      if (vehicle === game.driven) continue
      const t = vehicle.body.translation()
      const m = markers[n++] as MinimapMarker
      m.x = t.x + game.origin.x
      m.z = t.z + game.origin.z
    }
    renderer.draw(ctx, w, h, dpr, view, markers, n)
  }
  draw()
  const id = window.setInterval(draw, DRAW_MS)
  return { redraw: draw, stop: () => window.clearInterval(id) }
}

/** Runs the map loop on `canvas`. Returns a ref to a function forcing an immediate redraw. */
export function useMapCanvas(
  canvas: RefObject<HTMLCanvasElement | null>,
  game: Game,
  frame: (view: MinimapView) => void,
): RefObject<() => void> {
  const redraw = useRef<() => void>(() => {})
  const frameRef = useRef(frame)
  useEffect(() => {
    frameRef.current = frame
  })

  useEffect(() => {
    if (!canvas.current) return
    const loop = startMapLoop(canvas.current, game, () => frameRef.current)
    redraw.current = loop.redraw
    return loop.stop
  }, [canvas, game])

  return redraw
}

/** Corner minimap. Click it to open the full map. */
export function Minimap({ game, onExpand }: { game: Game; onExpand: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const zoom = useSettings((s) => s.minimapZoom)
  const setSetting = useSettings((s) => s.set)

  useMapCanvas(canvas, game, (view) => {
    const s = useSettings.getState()
    view.zoom = s.minimapZoom
    view.rotate = s.minimapRotate
    view.northMarker = true
  })

  const zoomBy = (f: number) => setSetting('minimapZoom', clampZoom(zoom * f))

  return (
    <div className="minimap">
      <canvas
        ref={canvas}
        className="minimap-canvas"
        title="Open map"
        onClick={onExpand}
        onWheel={(e) => zoomBy(e.deltaY > 0 ? 1.25 : 0.8)}
      />
      <div className="minimap-zoom">
        <button className="hud-btn icon" onClick={() => zoomBy(0.8)} aria-label="Zoom in">
          <PlusIcon size={16} />
        </button>
        <button className="hud-btn icon" onClick={() => zoomBy(1.25)} aria-label="Zoom out">
          <MinusIcon size={16} />
        </button>
      </div>
    </div>
  )
}
