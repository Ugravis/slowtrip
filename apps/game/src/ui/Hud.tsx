import { useEffect, useRef } from 'react'
import { useGameStore } from '../game/store'
import { TouchControls } from './TouchControls'

const isTouch = () => window.matchMedia('(pointer: coarse)').matches

export function Hud() {
  const game = useGameStore((s) => s.game)
  const speed = useRef<HTMLSpanElement>(null)

  // Polls the simulation at 10 Hz and writes the DOM directly: no per-frame React renders.
  useEffect(() => {
    if (!game) return
    const id = window.setInterval(() => {
      if (speed.current) speed.current.textContent = `${Math.round(game.speedKmh)} km/h`
    }, 100)
    return () => window.clearInterval(id)
  }, [game])

  if (!game) return <div className="hud-loading">Loading…</div>

  return (
    <div className="hud">
      <div className="hud-speed">
        <span ref={speed}>0 km/h</span>
      </div>
      {isTouch() ? (
        <TouchControls input={game.input} />
      ) : (
        <div className="hud-help">WASD / ZQSD drive · Space handbrake · R reset</div>
      )}
    </div>
  )
}
