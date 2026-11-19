import { Gamepad2Icon, KeyboardIcon, XIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { PlayerMode } from '../game/store'
import { usePanel } from './panels'
import { TOUCH_ICONS as I } from './TouchControls'

type Row = readonly [keys: ReactNode, action: string]

const DRIVE: Row[] = [
  ['WASD / ZQSD', 'Drive'],
  ['Space', 'Handbrake (toggle)'],
  ['L', 'Headlights'],
  ['Mouse', 'Look around (click to capture)'],
  ['C / V', 'Switch view'],
  ['R', 'Reset vehicle'],
  ['E / F', 'Get out'],
]
const WALK: Row[] = [
  ['WASD / ZQSD', 'Move'],
  ['Shift', 'Run'],
  ['Space', 'Jump'],
  ['Mouse', 'Look around (click to capture)'],
  ['E / F', 'Drive nearby vehicle'],
]
const UI: Row[] = [
  ['M', 'Map (or click the minimap)'],
  ['H', 'Controls'],
  ['O', 'Settings'],
  ['Esc', 'Release mouse'],
]
const TOUCH_DRIVE: Row[] = [
  ['Left stick', 'Throttle and steer'],
  ['Drag screen', 'Look around'],
  [<I.handbrake key="h" size={16} />, 'Handbrake (toggle)'],
  [<I.headlights key="l" size={16} />, 'Headlights'],
  [<I.reset key="r" size={16} />, 'Reset vehicle'],
  [<I.toggleView key="v" size={16} />, 'Switch view'],
  [<I.interact key="u" size={16} />, 'Get out'],
]
const TOUCH_WALK: Row[] = [
  ['Left stick', 'Move'],
  ['Drag screen', 'Look around'],
  [<I.sprint key="s" size={16} />, 'Run (hold)'],
  [<I.jump key="j" size={16} />, 'Jump'],
  [<I.interact key="u" size={16} />, 'Drive nearby vehicle'],
]

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="controls-list">
      {rows.map(([k, a]) => (
        <div key={a}>
          <dt>{k}</dt>
          <dd>{a}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Bottom-left: controls reference, collapsed by default. */
export function ControlsPanel({ mode, touch }: { mode: PlayerMode; touch: boolean }) {
  const [open, toggle] = usePanel('h', false)
  const driving = mode === 'driving'
  return (
    <div className="corner corner-bl">
      {open && (
        <div className="panel">
          <h2>{driving ? 'Driving' : 'On foot'}</h2>
          <Rows rows={touch ? (driving ? TOUCH_DRIVE : TOUCH_WALK) : driving ? DRIVE : WALK} />
          {!touch && (
            <>
              <h2>Interface</h2>
              <Rows rows={UI} />
            </>
          )}
        </div>
      )}
      <button
        className={open ? 'hud-btn icon active' : 'hud-btn icon'}
        onClick={toggle}
        aria-expanded={open}
        aria-label="Controls"
        title="Controls (H)"
      >
        {open ? (
          <XIcon size={18} />
        ) : touch ? (
          <Gamepad2Icon size={18} />
        ) : (
          <KeyboardIcon size={18} />
        )}
      </button>
    </div>
  )
}
