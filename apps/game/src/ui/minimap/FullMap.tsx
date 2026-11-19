import {
  LayersIcon,
  LocateFixedIcon,
  MapIcon,
  MinusIcon,
  PlusIcon,
  RadarIcon,
  XIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Game } from '../../game/Game'
import { BIOME_NAMES, BIOME_SRGB, WATER_SRGB, type Rgb } from '../../world/terrain/biomes'
import type { MapLayer } from '../../world/terrain/mapTile'
import type { MapOverview } from '../../world/terrain/mapTiles'
import { clampZoom, useMapCanvas } from './Minimap'

/** Full map can zoom out further than the minimap: tiles only exist where the player went. */
const FULL_ZOOM_MAX = 24
const FULL_ZOOM_DEFAULT = 4
/** Dev reveal radius, in chunks (~2 km). */
const REVEAL_RADIUS = 32
/** Zoom (m/px) after a reveal, to see the whole revealed area. */
const REVEAL_ZOOM = 8

/** Dev overview: area edge (m), resolution (m/px), zoom-out limit, and how far the view may
 * move from the image center before it is regenerated (m). */
const OVERVIEW_SIZE = 12000
const OVERVIEW_SCALE = 16
const OVERVIEW_ZOOM_MAX = 48
const OVERVIEW_REFRESH = 3500

const css = ([r, g, b]: Rgb) => `rgb(${r * 255} ${g * 255} ${b * 255})`

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
  const [layer, setLayer] = useState<MapLayer>('terrain')
  const [overviewOn, setOverviewOn] = useState(false)
  const [overviewBusy, setOverviewBusy] = useState(false)
  const overview = useRef<(MapOverview & { cx: number; cz: number; layer: MapLayer }) | null>(null)
  const overviewPending = useRef(false)
  const zoomMax = overviewOn ? OVERVIEW_ZOOM_MAX : FULL_ZOOM_MAX

  /** Regenerates the overview around the view center when it moved far enough away. */
  const refreshOverview = (cx: number, cz: number) => {
    const o = overview.current
    if (overviewPending.current) return
    if (
      o &&
      o.layer === layer &&
      Math.max(Math.abs(cx - o.cx), Math.abs(cz - o.cz)) < OVERVIEW_REFRESH
    ) {
      return
    }
    overviewPending.current = true
    setOverviewBusy(true)
    const area = {
      centerX: cx,
      centerZ: cz,
      width: OVERVIEW_SIZE,
      height: OVERVIEW_SIZE,
      scale: OVERVIEW_SCALE,
      layer,
    }
    void game.mapTiles.overview(area).then((img) => {
      overview.current?.bitmap.close()
      overview.current = { ...img, cx, cz, layer: area.layer }
      overviewPending.current = false
      // Redraws through the effect below.
      setOverviewBusy(false)
    })
  }

  const redraw = useMapCanvas(canvas, game, (view) => {
    view.centerX += pan.current.x
    view.centerZ += pan.current.z
    view.zoom = zoom.current
    view.rotate = false
    view.northMarker = false
    view.layer = layer
    view.labels = true
    view.overview = overviewOn ? overview.current : null
    if (overviewOn) refreshOverview(view.centerX, view.centerZ)
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
    zoom.current = clampZoom(zoom.current * f, zoomMax)
    schedule()
  }

  useEffect(() => redraw.current(), [layer, overviewOn, overviewBusy, redraw])
  useEffect(() => () => overview.current?.bitmap.close(), [])

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
        onDoubleClick={
          import.meta.env.DEV
            ? (e) => {
                // Dev: teleport to the clicked point (snaps onto the road when close).
                const rect = e.currentTarget.getBoundingClientRect()
                const pose = { x: 0, y: 0, z: 0, heading: 0 }
                game.pose(pose)
                game.teleport(
                  pose.x + pan.current.x + (e.clientX - rect.left - rect.width / 2) * zoom.current,
                  pose.z + pan.current.z + (e.clientY - rect.top - rect.height / 2) * zoom.current,
                )
                onClose()
              }
            : undefined
        }
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
        <button
          className={layer === 'biomes' ? 'hud-btn icon active' : 'hud-btn icon'}
          onClick={() => setLayer(layer === 'biomes' ? 'terrain' : 'biomes')}
          aria-pressed={layer === 'biomes'}
          aria-label="Biome layer"
          title="Biome layer"
        >
          <LayersIcon size={18} />
        </button>
        {import.meta.env.DEV && (
          <button
            className={overviewOn ? 'hud-btn icon active' : 'hud-btn icon'}
            onClick={() => {
              if (overviewOn) zoom.current = clampZoom(zoom.current, FULL_ZOOM_MAX)
              else
                zoom.current = clampZoom(Math.max(zoom.current, OVERVIEW_SCALE), OVERVIEW_ZOOM_MAX)
              setOverviewOn(!overviewOn)
            }}
            aria-pressed={overviewOn}
            aria-label="World overview (dev)"
            title={`Dev: world and road overview (${OVERVIEW_SIZE / 1000} km), double-click to teleport`}
          >
            <MapIcon size={18} />
          </button>
        )}
        {import.meta.env.DEV && (
          <button
            className="hud-btn icon"
            onClick={() => {
              game.revealAround(REVEAL_RADIUS)
              pan.current.x = 0
              pan.current.z = 0
              zoom.current = clampZoom(Math.max(zoom.current, REVEAL_ZOOM), FULL_ZOOM_MAX)
              schedule()
            }}
            aria-label="Reveal area (dev)"
            title={`Dev: reveal ${REVEAL_RADIUS} chunks around the player`}
          >
            <RadarIcon size={18} />
          </button>
        )}
      </div>
      <div className="map-full-legend">
        {layer === 'biomes' ? (
          <>
            {BIOME_NAMES.map((name, i) => (
              <span key={name} className="map-legend-item">
                <i style={{ background: css(BIOME_SRGB[i] as Rgb) }} />
                {name}
              </span>
            ))}
            <span className="map-legend-item">
              <i style={{ background: css(WATER_SRGB) }} />
              Water
            </span>
          </>
        ) : (
          `${overviewOn ? (overviewBusy ? 'generating overview… · ' : 'overview: road in red, bridges in yellow · ') : ''}▲ peak · )( pass${overviewOn ? '' : ' · explored area only'} · drag to pan · wheel or pinch to zoom${
            import.meta.env.DEV ? ' · dev: double-click to teleport' : ''
          }`
        )}
      </div>
    </div>
  )
}
