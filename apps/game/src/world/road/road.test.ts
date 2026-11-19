import { describe, expect, it } from 'vitest'
import { createWorldGen } from '../terrain/heightSampler'
import { BAND_LENGTH } from './roadGen'
import { WATER_LEVEL } from '../constants'
import { ROAD_FLAT_HALF } from './roadNetwork'

describe('road', () => {
  const seed = 1337

  it('is deterministic and bands agree on shared points', () => {
    const a = createWorldGen(seed).roads
    const b = createWorldGen(seed).roads
    const b1 = a.compute(1)
    expect(b.compute(1).x).toEqual(b1.x)
    // Computed independently, band 0 ends exactly where band 1 starts.
    const b0 = b.compute(0)
    const last = b0.x.length - 1
    expect(b0.x[last]).toBe(b1.x[0])
    expect(b0.z[last]).toBe(b1.z[0])
    expect(b0.h[last]).toBe(b1.h[0])
  })

  it('heads north with gentle grades, for several seeds', () => {
    for (const s of [1, 42, 1337, 9001]) {
      const roads = createWorldGen(s).roads
      let maxGrade = 0
      let total = 0
      let steep = 0
      let startX = 0
      let endX = 0
      const bands = 8
      const t0 = performance.now()
      for (let k = 0; k < bands; k++) {
        const d = roads.compute(k)
        const n = d.x.length
        if (k === 0) startX = d.x[0] as number
        endX = d.x[n - 1] as number
        for (let i = 0; i + 4 < n; i += 4) {
          // Arc length, not chord: hairpins would look steeper than they are.
          let run = 0
          for (let j = i; j < i + 4; j++) {
            run += Math.hypot(
              (d.x[j + 1] as number) - (d.x[j] as number),
              (d.z[j + 1] as number) - (d.z[j] as number),
            )
          }
          const grade = Math.abs((d.h[i + 4] as number) - (d.h[i] as number)) / run
          maxGrade = Math.max(maxGrade, grade)
          total += run
          if (grade > 0.12) steep += run
        }
        expect(d.z[n - 1] as number).toBeLessThan((d.z[0] as number) - BAND_LENGTH * 0.9)
      }
      const ms = (performance.now() - t0) / bands
      console.log(
        `seed ${s}: max grade ${(maxGrade * 100).toFixed(1)}%, ${((steep / total) * 100).toFixed(2)}% over 12%, drift ${Math.round(endX - startX)} m, ${ms.toFixed(1)} ms/band`,
      )
      // Mountain roads may have short steep ramps, never long ones.
      expect(maxGrade).toBeLessThan(0.13)
      expect(steep / total).toBeLessThan(0.005)
    }
  })

  it('levels the terrain flat across the road', () => {
    const gen = createWorldGen(seed)
    const d = gen.roads.compute(0)
    for (let i = 10; i < d.x.length; i += 37) {
      const x = d.x[i] as number
      const z = d.z[i] as number
      const nx = -(d.dz[i] as number)
      const nz = d.dx[i] as number
      const hc = gen.height(x, z)
      for (const o of [-ROAD_FLAT_HALF + 1, ROAD_FLAT_HALF - 1]) {
        expect(Math.abs(gen.height(x + nx * o, z + nz * o) - hc)).toBeLessThan(0.15)
      }
      expect(Math.abs(hc - (d.h[i] as number))).toBeLessThan(0.05)
    }
  })

  it('bridges lakes in its way, above the water, without leveling the lake', () => {
    const gen = createWorldGen(9001)
    let bridged = 0
    let wet = 0
    for (let k = 0; k < 12; k++) {
      const d = gen.roads.compute(k)
      for (let i = 0; i < d.x.length; i++) {
        if (!d.bridge[i]) continue
        bridged++
        expect(d.h[i] as number).toBeGreaterThan(WATER_LEVEL + 1)
        // Never above the deck: flush under its ends (embankments), lower over the water.
        const ground = gen.height(d.x[i] as number, d.z[i] as number)
        expect(ground).toBeLessThan((d.h[i] as number) + 0.05)
        if (ground < WATER_LEVEL) wet++
      }
    }
    expect(bridged).toBeGreaterThan(0)
    // The lake under the deck is not filled in.
    expect(wet).toBeGreaterThan(0)
  })
})
