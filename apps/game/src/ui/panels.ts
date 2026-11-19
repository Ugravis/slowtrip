import { useEffect, useState } from 'react'

export const isTouch = () => window.matchMedia('(pointer: coarse)').matches

/**
 * Open/closed state of a HUD panel, toggled by a key (layout-aware `e.key`).
 * Opening releases the pointer lock so the panel can be used with the mouse.
 */
export function usePanel(key: string, initial: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(initial)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.key.toLowerCase() !== key) return
      setOpen((o) => !o)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key])
  useEffect(() => {
    if (open && document.pointerLockElement) document.exitPointerLock()
  }, [open, key])
  return [open, () => setOpen((o) => !o)]
}
