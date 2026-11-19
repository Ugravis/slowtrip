/** Edge-triggered actions: read once with `consume`. */
export type InputAction = 'interact' | 'toggleView' | 'reset' | 'jump'

const KEY_ACTIONS: Record<string, InputAction> = {
  KeyE: 'interact',
  KeyF: 'interact',
  KeyC: 'toggleView',
  KeyV: 'toggleView',
  KeyR: 'reset',
  Space: 'jump',
}

/**
 * Unified input state for keyboard, mouse and touch. Systems read it every frame;
 * DOM listeners and touch UI write into it. No React state involved.
 */
export class Input {
  /** Movement axes in [-1, 1]: x = right, y = forward. Throttle/steer when driving. */
  readonly move = { x: 0, y: 0 }
  /** Look delta accumulated since the last `consumeLook`, in pixels. */
  readonly look = { x: 0, y: 0 }
  /** Held buttons. */
  sprint = false
  brake = false
  /** Analog stick from the touch UI, merged with the keyboard axes. */
  readonly stick = { x: 0, y: 0 }

  private touchSprint = false
  private touchBrake = false
  private readonly keys = new Set<string>()
  private readonly pending = new Set<InputAction>()

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return
    const code = keyCode(e)
    this.keys.add(code)
    const action = KEY_ACTIONS[code]
    if (action) this.pending.add(action)
    if (code === 'Space' || code.startsWith('Arrow')) e.preventDefault()
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(keyCode(e))
  }

  private readonly onBlur = () => {
    this.keys.clear()
  }

  private readonly onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement) this.addLook(e.movementX, e.movementY)
  }

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown)
    target.addEventListener('keyup', this.onKeyUp)
    target.addEventListener('blur', this.onBlur)
    target.addEventListener('mousemove', this.onMouseMove)
  }

  /** Locks the mouse on click (desktop first-person look). */
  attachPointerLock(element: HTMLElement): () => void {
    const onClick = () => {
      if (!document.pointerLockElement && window.matchMedia('(pointer: fine)').matches) {
        void element.requestPointerLock()
      }
    }
    element.addEventListener('click', onClick)
    return () => element.removeEventListener('click', onClick)
  }

  /** Drops unconsumed edge actions so they never fire late. Call at the end of each frame. */
  endFrame(): void {
    this.pending.clear()
    this.consumeLook()
  }

  /** Recomputes axes from keys and the touch stick. Call once per frame before systems. */
  poll(): void {
    const k = this.keys
    const kx =
      (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) -
      (k.has('KeyA') || k.has('KeyQ') || k.has('ArrowLeft') ? 1 : 0)
    const ky =
      (k.has('KeyW') || k.has('KeyZ') || k.has('ArrowUp') ? 1 : 0) -
      (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
    this.move.x = clamp1(kx + this.stick.x)
    this.move.y = clamp1(ky + this.stick.y)
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight') || this.touchSprint
    this.brake = k.has('Space') || this.touchBrake
  }

  setStick(x: number, y: number): void {
    this.stick.x = x
    this.stick.y = y
  }

  setTouchBrake(held: boolean): void {
    this.touchBrake = held
  }

  setTouchSprint(held: boolean): void {
    this.touchSprint = held
  }

  /** Fires an edge-triggered action (touch buttons). */
  trigger(action: InputAction): void {
    this.pending.add(action)
  }

  /** Returns true once per press. */
  consume(action: InputAction): boolean {
    return this.pending.delete(action)
  }

  addLook(dx: number, dy: number): void {
    this.look.x += dx
    this.look.y += dy
  }

  /** Clears the accumulated look delta (call after reading `look`). */
  consumeLook(): void {
    this.look.x = 0
    this.look.y = 0
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown)
    this.target.removeEventListener('keyup', this.onKeyUp)
    this.target.removeEventListener('blur', this.onBlur)
  }
}

/** Physical key code, falling back to `key` when `code` is empty (some virtual keyboards). */
function keyCode(e: KeyboardEvent): string {
  if (e.code) return e.code
  const k = e.key
  if (k.length === 1 && /[a-z]/i.test(k)) return `Key${k.toUpperCase()}`
  if (k === ' ') return 'Space'
  return k
}

function clamp1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v
}
