import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { Input, InputAction } from '../core/input'

const STICK_RADIUS = 50

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

export function TouchControls({ input }: { input: Input }) {
  return (
    <div className="touch-layer">
      <Joystick input={input} />
      <div className="touch-buttons">
        <HoldButton label="Brake" onChange={(held) => input.setTouchBrake(held)} />
        <ActionButton input={input} action="reset" label="Reset" />
      </div>
    </div>
  )
}
