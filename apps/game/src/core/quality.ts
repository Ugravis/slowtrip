export type QualityTier = 'low' | 'medium' | 'high'

export interface QualitySettings {
  tier: QualityTier
  /** Terrain view radius, in chunks. */
  viewRadius: number
  dpr: [number, number]
  antialias: boolean
}

const PRESETS: Record<QualityTier, Omit<QualitySettings, 'tier'>> = {
  low: { viewRadius: 3, dpr: [0.75, 1.25], antialias: false },
  medium: { viewRadius: 4, dpr: [1, 1.5], antialias: true },
  high: { viewRadius: 6, dpr: [1, 2], antialias: true },
}

function isTier(value: string | null): value is QualityTier {
  return value === 'low' || value === 'medium' || value === 'high'
}

/** Mobile defaults to low, desktop to high. Override with `?quality=low|medium|high`. */
export function detectQuality(): QualitySettings {
  const param = new URLSearchParams(window.location.search).get('quality')
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const tier: QualityTier = isTier(param) ? param : coarse ? 'low' : 'high'
  return { tier, ...PRESETS[tier] }
}
