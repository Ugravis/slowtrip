import { create } from 'zustand'
import type { Game } from './Game'

/** Low-frequency UI state only. Never written per frame. */
interface GameUiState {
  game: Game | null
  vehicleName: string | null
  setGame: (game: Game | null) => void
}

export const useGameStore = create<GameUiState>((set) => ({
  game: null,
  vehicleName: null,
  setGame: (game) => set({ game }),
}))
