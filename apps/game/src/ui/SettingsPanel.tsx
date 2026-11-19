import { useEffect, useRef, type ReactNode } from 'react'
import type { QualityTier } from '../core/quality'
import { RELOAD_SEED_KEY, useSettings, type SettingsValues } from '../core/settings'
import type { Game } from '../game/Game'
import { formatTime } from '../world/sky/dayNight'

function Field({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {value !== undefined && <span className="field-value">{value}</span>}
      </span>
      {children}
    </label>
  )
}

function Toggle({
  k,
  label,
}: {
  k: 'showPerf' | 'invertY' | 'timePaused' | 'minimapRotate'
  label: string
}) {
  const value = useSettings((s) => s[k])
  const set = useSettings((s) => s.set)
  return (
    <label className="field field-row">
      <span className="field-label">{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => set(k, e.target.checked)} />
    </label>
  )
}

function Slider({
  k,
  label,
  min,
  max,
  step,
  format,
}: {
  k: 'fov' | 'lookSensitivity' | 'dayLengthMin'
  label: string
  min: number
  max: number
  step: number
  format: (v: number) => string
}) {
  const value = useSettings((s) => s[k])
  const set = useSettings((s) => s.set)
  return (
    <Field label={label} value={format(value)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => set(k, Number(e.target.value))}
      />
    </Field>
  )
}

/** Time of day lives in the simulation, not in settings: the slider writes it directly. */
function TimeOfDay({ game }: { game: Game }) {
  const input = useRef<HTMLInputElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const dragging = useRef(false)
  useEffect(() => {
    const sync = () => {
      if (label.current) label.current.textContent = formatTime(game.dayNight.time)
      if (input.current && !dragging.current) input.current.value = String(game.dayNight.time)
    }
    sync()
    const id = window.setInterval(sync, 500)
    return () => window.clearInterval(id)
  }, [game])
  return (
    <label className="field">
      <span className="field-label">
        Time of day
        <span ref={label} className="field-value" />
      </span>
      <input
        ref={input}
        type="range"
        min={0}
        max={23.99}
        step={0.05}
        defaultValue={game.dayNight.time}
        onPointerDown={() => (dragging.current = true)}
        onPointerUp={() => (dragging.current = false)}
        onChange={(e) => {
          const hours = Number(e.target.value)
          game.dayNight.setTime(hours)
          if (label.current) label.current.textContent = formatTime(hours)
        }}
      />
    </label>
  )
}

/** Bottom-right settings. Quality needs a reload (canvas and world are rebuilt), same seed. */
export function SettingsPanel({ game }: { game: Game }) {
  const quality = useSettings((s) => s.quality)
  const set = useSettings((s) => s.set)
  const reset = useSettings((s) => s.reset)

  const changeQuality = (value: string) => {
    const tier = (value === 'auto' ? null : value) as SettingsValues['quality']
    set('quality', tier)
    sessionStorage.setItem(RELOAD_SEED_KEY, String(game.seed))
    window.location.reload()
  }

  return (
    <div className="panel settings">
      <h2>Settings</h2>
      <Field label="Quality" value={`now ${game.quality.tier}`}>
        <select value={quality ?? 'auto'} onChange={(e) => changeQuality(e.target.value)}>
          <option value="auto">Auto</option>
          {(['low', 'medium', 'high'] as QualityTier[]).map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </Field>
      <Toggle k="showPerf" label="Perf overlay" />

      <h2>Camera</h2>
      <Slider k="fov" label="Field of view" min={50} max={90} step={1} format={(v) => `${v}°`} />
      <Slider
        k="lookSensitivity"
        label="Look sensitivity"
        min={0.2}
        max={3}
        step={0.1}
        format={(v) => `${v.toFixed(1)}×`}
      />
      <Toggle k="invertY" label="Invert vertical look" />

      <h2>Day / night</h2>
      <TimeOfDay game={game} />
      <Slider
        k="dayLengthMin"
        label="Day length"
        min={1}
        max={60}
        step={1}
        format={(v) => `${v} min`}
      />
      <Toggle k="timePaused" label="Pause time" />

      <h2>Minimap</h2>
      <Toggle k="minimapRotate" label="Rotate with heading" />

      <button className="hud-btn wide" onClick={reset}>
        Reset to defaults
      </button>
    </div>
  )
}
