import { LocateFixedIcon, MinusIcon, PlusIcon, XIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { Game } from '../../game/Game'
import { clampZoom, useMapCanvas } from './Minimap'

/** Full map can zoom out further than the minimap: tiles only exist where the player went. */
const FULL_ZOOM_MAX = 24
const FULL_ZOOM_DEFAULT = 4

/**
 * Fullscreen map, north-up. Drag to pan, wheel or pinch to zoom.
 * Pan is an offset from the player, so the map keeps following while open.
 */
export function FullMap({ game, onClose }: { game: Game; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const zoom = useRef(FULL_ZOOM_DEFAULT)
  const pan = useRef({ x: 0, z: 0 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef(0)
  const pending = useRef(false)

  const redraw = useMapCanvas(canvas, game, (view) => {
    view.centerX += pan.current.x
    view.centerZ += pan.current.z
    view.zoom = zoom.current
    view.rotate = false
    view.northMarker = false
  })

  /** Redraws on the next animation frame (coalesces pointer events). */
  const schedule = () => {
    if (pending.current) return
    pending.current = true
    requestAnimationFrame(() => {
      pending.current = false
      redraw.current()
    })
  }

  const zoomBy = (f: number) => {
    zoom.current = clampZoom(zoom.current * f, FULL_ZOOM_MAX)
    schedule()
  }

  useEffect(() => {
    if (document.pointerLockElement) document.exitPointerLock()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const spread = () => {
    const [a, b] = [...pointers.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  return (
    <div className="map-full">
      <canvas
        ref={canvas}
        className="map-full-canvas"
        onWheel={(e) => zoomBy(e.deltaY > 0 ? 1.2 : 1 / 1.2)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          pinch.current = spread()
        }}
        onPointerMove={(e) => {
          const p = pointers.current.get(e.pointerId)
          if (!p) return
          const dx = e.clientX - p.x
          const dy = e.clientY - p.y
          p.x = e.clientX
          p.y = e.clientY
          if (pointers.current.size >= 2) {
            const d = spread()
            if (pinch.current > 0 && d > 0) zoomBy(pinch.current / d)
            pinch.current = d
            return
          }
          pan.current.x -= dx * zoom.current
          pan.current.z -= dy * zoom.current
          schedule()
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId)
          pinch.current = spread()
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId)
          pinch.current = spread()
        }}
      />
      <div className="map-full-tools">
        <button
          className="hud-btn icon"
          onClick={onClose}
          aria-label="Close map"
          title="Close (Esc)"
        >
          <XIcon size={18} />
        </button>
        <button className="hud-btn icon" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom in">
          <PlusIcon size={18} />
        </button>
        <button className="hud-btn icon" onClick={() => zoomBy(1.25)} aria-label="Zoom out">
          <MinusIcon size={18} />
        </button>
        <button
          className="hud-btn icon"
          onClick={() => {
            pan.current.x = 0
            pan.current.z = 0
            schedule()
          }}
          aria-label="Center on player"
          title="Center on player"
        >
          <LocateFixedIcon size={18} />
        </button>
      </div>
      <div className="map-full-legend">
        Explored area only · drag to pan · wheel or pinch to zoom
      </div>
    </div>
  )
}
