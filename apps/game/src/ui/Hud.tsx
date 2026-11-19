import { SettingsIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useGameStore } from '../game/store'
import { ControlsPanel } from './ControlsPanel'
import { FullMap } from './minimap/FullMap'
import { Minimap } from './minimap/Minimap'
import { isTouch, usePanel } from './panels'
import { SettingsPanel } from './SettingsPanel'
import { StatsPanel } from './StatsPanel'
import { TouchControls } from './TouchControls'

export function Hud() {
  const game = useGameStore((s) => s.game)
  const mode = useGameStore((s) => s.mode)
  const hint = useRef<HTMLDivElement>(null)
  const touch = isTouch()
  const [settingsOpen, toggleSettings] = usePanel('o', false)
  /** M toggles the full map; the minimap is always shown. */
  const [mapFull, toggleMapFull] = usePanel('m', false)

  // Polls the simulation at 10 Hz and writes the DOM directly: no per-frame React renders.
  useEffect(() => {
    if (!game) return
    const id = window.setInterval(() => {
      if (hint.current) {
        const text = game.hint ?? ''
        if (hint.current.textContent !== text) hint.current.textContent = text
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [game])

  if (!game) return <div className="hud-loading">Loading…</div>

  return (
    <div className={touch ? 'hud touch' : 'hud'}>
      {mode !== 'driving' && <div className="crosshair" />}
      <div ref={hint} className="hud-hint" />
      <StatsPanel game={game} />
      {touch && <TouchControls input={game.input} mode={mode} />}
      <ControlsPanel mode={mode} touch={touch} />
      <div className="corner corner-br">
        {settingsOpen && <SettingsPanel game={game} />}
        <Minimap game={game} onExpand={toggleMapFull} />
        <div className="corner-buttons">
          <button
            className={settingsOpen ? 'hud-btn icon active' : 'hud-btn icon'}
            onClick={toggleSettings}
            aria-expanded={settingsOpen}
            aria-label="Settings"
            title="Settings (O)"
          >
            <SettingsIcon size={18} />
          </button>
        </div>
      </div>
      {mapFull && <FullMap game={game} onClose={toggleMapFull} />}
    </div>
  )
}
