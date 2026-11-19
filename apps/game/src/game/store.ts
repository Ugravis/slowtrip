import { create } from 'zustand'
import type { Game } from './Game'

/** Low-frequency UI state only. Never written per frame. */
export type PlayerMode = 'onFoot' | 'driving'

interface GameUiState {
  game: Game | null
  mode: PlayerMode
  setGame: (game: Game | null) => void
  setMode: (mode: PlayerMode) => void
}

export const useGameStore = create<GameUiState>((set) => ({
  game: null,
  mode: 'onFoot',
  setGame: (game) => set({ game }),
  setMode: (mode) => set({ mode }),
}))
