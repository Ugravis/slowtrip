import {
  ArrowBigUpIcon,
  CircleParkingIcon,
  FlashlightIcon,
  FootprintsIcon,
  HandIcon,
  RotateCcwIcon,
  SwitchCameraIcon,
  type LucideIcon,
} from 'lucide-react'
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { Input, InputAction } from '../core/input'
import { useGameStore, type PlayerMode } from '../game/store'

/** Icons of the touch buttons (also shown in the controls panel). */
export const TOUCH_ICONS = {
  handbrake: CircleParkingIcon,
  headlights: FlashlightIcon,
  reset: RotateCcwIcon,
  toggleView: SwitchCameraIcon,
  interact: HandIcon,
  sprint: FootprintsIcon,
  jump: ArrowBigUpIcon,
} satisfies Record<string, LucideIcon>

const ICON_SIZE = 26

const STICK_RADIUS = 50
const LOOK_SCALE = 2.2

/** Virtual joystick: writes into `input.stick`, moves its knob via a ref (no React state). */
function Joystick({ input }: { input: Input }) {
  const base = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  const pointer = useRef<number | null>(null)

  const move = (e: ReactPointerEvent) => {
    if (pointer.current !== e.pointerId || !base.current || !knob.current) return
    const rect = base.current.getBoundingClientRect()
    let dx = e.clientX - (rect.left + rect.width / 2)
    let dy = e.clientY - (rect.top + rect.height / 2)
    const len = Math.hypot(dx, dy)
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS
      dy = (dy / len) * STICK_RADIUS
    }
    input.setStick(dx / STICK_RADIUS, -dy / STICK_RADIUS)
    knob.current.style.transform = `translate(${dx}px, ${dy}px)`
  }

  const end = (e: ReactPointerEvent) => {
    if (pointer.current !== e.pointerId) return
    pointer.current = null
    input.setStick(0, 0)
    if (knob.current) knob.current.style.transform = ''
  }

  return (
    <div
      ref={base}
      className="stick"
      onPointerDown={(e) => {
        pointer.current = e.pointerId
        e.currentTarget.setPointerCapture(e.pointerId)
        move(e)
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div ref={knob} className="stick-knob" />
    </div>
  )
}

export function ActionButton({
  input,
  action,
  label,
  icon: Icon,
  active = false,
}: {
  input: Input
  action: InputAction
  label: string
  icon: LucideIcon
  /** Highlighted (toggle actions that are on). */
  active?: boolean
}) {
  return (
    <button
      className={active ? 'touch-btn active' : 'touch-btn'}
      aria-label={label}
      aria-pressed={active}
      onPointerDown={(e) => {
        e.stopPropagation()
        input.trigger(action)
      }}
    >
      <Icon size={ICON_SIZE} />
    </button>
  )
}

export function HoldButton({
  label,
  icon: Icon,
  onChange,
}: {
  label: string
  icon: LucideIcon
  onChange: (held: boolean) => void
}) {
  return (
    <button
      className="touch-btn"
      aria-label={label}
      onPointerDown={(e) => {
        e.stopPropagation()
        onChange(true)
      }}
      onPointerUp={() => onChange(false)}
      onPointerCancel={() => onChange(false)}
      onPointerLeave={() => onChange(false)}
    >
      <Icon size={ICON_SIZE} />
    </button>
  )
}

/** Drag anywhere outside the stick and buttons to look around. */
function LookZone({ input }: { input: Input }) {
  const last = useRef<{ id: number; x: number; y: number } | null>(null)
  return (
    <div
      className="look-zone"
      onPointerDown={(e) => {
        last.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const l = last.current
        if (!l || l.id !== e.pointerId) return
        input.addLook((e.clientX - l.x) * LOOK_SCALE, (e.clientY - l.y) * LOOK_SCALE)
        l.x = e.clientX
        l.y = e.clientY
      }}
      onPointerUp={() => (last.current = null)}
      onPointerCancel={() => (last.current = null)}
    />
  )
}

export function TouchControls({ input, mode }: { input: Input; mode: PlayerMode }) {
  const handbrake = useGameStore((s) => s.handbrake)
  const headlights = useGameStore((s) => s.headlights)
  const I = TOUCH_ICONS
  return (
    <div className="touch-layer">
      <LookZone input={input} />
      <Joystick input={input} />
      <div className="touch-buttons">
        {mode === 'driving' ? (
          <>
            <ActionButton
              input={input}
              action="handbrake"
              label="Handbrake"
              icon={I.handbrake}
              active={handbrake}
            />
            <ActionButton
              input={input}
              action="headlights"
              label="Headlights"
              icon={I.headlights}
              active={headlights}
            />
            <ActionButton input={input} action="reset" label="Reset" icon={I.reset} />
            <ActionButton input={input} action="toggleView" label="View" icon={I.toggleView} />
          </>
        ) : (
          <>
            <HoldButton
              label="Run"
              icon={I.sprint}
              onChange={(held) => input.setTouchSprint(held)}
            />
            <ActionButton input={input} action="jump" label="Jump" icon={I.jump} />
          </>
        )}
        <ActionButton input={input} action="interact" label="Use" icon={I.interact} />
      </div>
    </div>
  )
}
