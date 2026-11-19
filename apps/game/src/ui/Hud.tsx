import { useEffect, useRef } from 'react'
import { useGameStore } from '../game/store'
import { TouchControls } from './TouchControls'

const DRIVE_HELP = 'WASD / ZQSD drive · Space handbrake · C view · Mouse look · R reset · E get out'
const WALK_HELP = 'Click to look · WASD / ZQSD move · Shift run · Space jump · E drive'

const isTouch = () => window.matchMedia('(pointer: coarse)').matches

export function Hud() {
  const game = useGameStore((s) => s.game)
  const mode = useGameStore((s) => s.mode)
  const speed = useRef<HTMLSpanElement>(null)
  const hint = useRef<HTMLDivElement>(null)

  // Polls the simulation at 10 Hz and writes the DOM directly: no per-frame React renders.
  useEffect(() => {
    if (!game) return
    const id = window.setInterval(() => {
      if (speed.current) speed.current.textContent = `${Math.round(game.speedKmh)} km/h`
      if (hint.current) {
        const text = game.hint ?? ''
        if (hint.current.textContent !== text) hint.current.textContent = text
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [game])

  if (!game) return <div className="hud-loading">Loading…</div>

  return (
    <div className="hud">
      {mode === 'driving' ? (
        <div className="hud-speed">
          <span ref={speed}>0 km/h</span>
        </div>
      ) : (
        <div className="crosshair" />
      )}
      <div ref={hint} className="hud-hint" />
      {isTouch() ? (
        <TouchControls input={game.input} mode={mode} />
      ) : (
        <div className="hud-help">{mode === 'driving' ? DRIVE_HELP : WALK_HELP}</div>
      )}
    </div>
  )
}
