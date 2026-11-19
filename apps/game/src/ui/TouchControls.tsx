import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { Input, InputAction } from '../core/input'
import type { PlayerMode } from '../game/store'

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
}: {
  input: Input
  action: InputAction
  label: string
}) {
  return (
    <button
      className="touch-btn"
      onPointerDown={(e) => {
        e.stopPropagation()
        input.trigger(action)
      }}
    >
      {label}
    </button>
  )
}

export function HoldButton({
  label,
  onChange,
}: {
  label: string
  onChange: (held: boolean) => void
}) {
  return (
    <button
      className="touch-btn"
      onPointerDown={(e) => {
        e.stopPropagation()
        onChange(true)
      }}
      onPointerUp={() => onChange(false)}
      onPointerCancel={() => onChange(false)}
      onPointerLeave={() => onChange(false)}
    >
      {label}
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
  return (
    <div className="touch-layer">
      <LookZone input={input} />
      <Joystick input={input} />
      <div className="touch-buttons">
        {mode === 'driving' ? (
          <>
            <HoldButton label="Brake" onChange={(held) => input.setTouchBrake(held)} />
            <ActionButton input={input} action="reset" label="Reset" />
            <ActionButton input={input} action="toggleView" label="View" />
          </>
        ) : (
          <>
            <HoldButton label="Run" onChange={(held) => input.setTouchSprint(held)} />
            <ActionButton input={input} action="jump" label="Jump" />
          </>
        )}
        <ActionButton input={input} action="interact" label="Use" />
      </div>
    </div>
  )
}
