import { create } from 'zustand'
import type { CameraView } from '../camera/CameraRig'
import type { Game } from './Game'

/** Low-frequency UI state only. Never written per frame. */
export type PlayerMode = 'onFoot' | 'driving'

interface GameUiState {
  game: Game | null
  mode: PlayerMode
  /** Vehicle camera view (on foot is always first person). */
  view: CameraView
  /** Toggled states shown on touch buttons and in the HUD. Written on change only. */
  handbrake: boolean
  headlights: boolean
  setGame: (game: Game | null) => void
  setMode: (mode: PlayerMode) => void
  setView: (view: CameraView) => void
  setHandbrake: (on: boolean) => void
  setHeadlights: (on: boolean) => void
}

export const useGameStore = create<GameUiState>((set) => ({
  game: null,
  mode: 'onFoot',
  setGame: (game) => set({ game }),
  view: 'third',
  setMode: (mode) => set({ mode }),
  setView: (view) => set({ view }),
  handbrake: false,
  headlights: false,
  setHandbrake: (handbrake) => set({ handbrake }),
  setHeadlights: (headlights) => set({ headlights }),
}))
