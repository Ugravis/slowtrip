import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QualityTier } from './quality'

/** Player-tunable settings, persisted in localStorage. Read per frame with `getState()` only. */
export interface SettingsValues {
  /** null = auto (mobile low, desktop high). Applied on reload. */
  quality: QualityTier | null
  /** r3f-perf overlay (draw calls, triangles, GPU/CPU time). */
  showPerf: boolean
  /** Base vertical field of view, in degrees. */
  fov: number
  /** Look sensitivity multiplier (mouse and touch). */
  lookSensitivity: number
  invertY: boolean
  /** Real minutes for a full in-game day. */
  dayLengthMin: number
  timePaused: boolean
  /** Minimap scale, in meters per CSS pixel. */
  minimapZoom: number
  /** Heading-up minimap (otherwise north-up). */
  minimapRotate: boolean
}

interface SettingsState extends SettingsValues {
  set: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void
  reset: () => void
}

export const DEFAULT_SETTINGS: SettingsValues = {
  quality: null,
  showPerf: false,
  fov: 65,
  lookSensitivity: 1,
  invertY: false,
  dayLengthMin: 20,
  timePaused: false,
  minimapZoom: 2,
  minimapRotate: false,
}

/** sessionStorage key keeping the seed across a settings reload (quality change). */
export const RELOAD_SEED_KEY = 'slowtrip:reload-seed'

export const MINIMAP_ZOOM_MIN = 0.5
export const MINIMAP_ZOOM_MAX = 8

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => set({ [key]: value } as Partial<SettingsValues>),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    { name: 'slowtrip-settings', version: 1 },
  ),
)
