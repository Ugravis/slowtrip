import { describe, expect, it } from 'vitest'
import { createSkyState, DayNight, formatTime } from './dayNight'

describe('DayNight', () => {
  it('wraps time over 24 h', () => {
    const dn = new DayNight(23)
    // 1 min day length: 1 real second = 0.4 h.
    dn.advance(5, 1)
    expect(dn.time).toBeCloseTo(1, 5)
  })

  it('is bright at noon and dark at midnight', () => {
    const sky = createSkyState()
    const dn = new DayNight(12)
    dn.apply(sky)
    expect(sky.sunElevation).toBeCloseTo(1, 5)
    expect(sky.lightIntensity).toBeGreaterThan(1)
    expect(sky.lightDir.y).toBeGreaterThan(0.8)
    const noonSky = sky.sky.r + sky.sky.g + sky.sky.b

    dn.time = 0
    dn.apply(sky)
    expect(sky.sunElevation).toBeCloseTo(-1, 5)
    expect(sky.lightIntensity).toBeLessThan(0.5)
    // Moonlight still comes from above the horizon.
    expect(sky.lightDir.y).toBeGreaterThan(0)
    expect(sky.sky.r + sky.sky.g + sky.sky.b).toBeLessThan(noonSky / 4)
  })

  it('formats hours', () => {
    expect(formatTime(6.5)).toBe('06:30')
    expect(formatTime(23.99)).toBe('23:59')
  })
})
