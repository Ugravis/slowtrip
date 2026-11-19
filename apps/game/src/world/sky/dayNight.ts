import * as THREE from 'three'

/** Sky state for the current time of day. Mutated in place: no allocation per frame. */
export interface SkyState {
  /** Unit vector toward the active light (sun by day, moon by night). */
  readonly lightDir: THREE.Vector3
  readonly lightColor: THREE.Color
  lightIntensity: number
  readonly sky: THREE.Color
  readonly hemiSky: THREE.Color
  readonly hemiGround: THREE.Color
  hemiIntensity: number
  /** Sun elevation in [-1, 1] (sine of its angle above the horizon). */
  sunElevation: number
}

interface Stop {
  /** Sun elevation where this stop applies. */
  e: number
  sky: THREE.Color
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  hemi: number
}

const c = (hex: string) => new THREE.Color(hex)

/** Keyframes by sun elevation, from deep night to full day. Colors are sRGB hex (converted to linear). */
const STOPS: Stop[] = [
  { e: -0.35, sky: c('#0a1326'), hemiSky: c('#5a70a8'), hemiGround: c('#252c1c'), hemi: 0.6 },
  { e: -0.08, sky: c('#22305a'), hemiSky: c('#6a7cb0'), hemiGround: c('#2c3220'), hemi: 0.65 },
  { e: 0.04, sky: c('#e3976b'), hemiSky: c('#f0c3a0'), hemiGround: c('#4a4630'), hemi: 0.6 },
  { e: 0.22, sky: c('#a8c8e0'), hemiSky: c('#dfefff'), hemiGround: c('#5a6b3a'), hemi: 0.9 },
]

const SUN_DAY = c('#fff4e0')
const SUN_LOW = c('#ffb070')
const MOON = c('#9fb4e6')
const SUN_INTENSITY = 1.4
const MOON_INTENSITY = 0.45
/** Tilt of the sun's path toward +z (radians), so noon light is not straight down. */
const TILT = 0.45

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Day/night cycle. Plain TS: `time` is in hours [0, 24), 6 h sunrise, 18 h sunset.
 * `apply` writes the sky state; Scene copies it to the lights.
 */
export class DayNight {
  time: number

  constructor(startHour = 10) {
    this.time = startHour
  }

  /** Sets the time of day, in hours (wrapped to [0, 24)). */
  setTime(hours: number): void {
    this.time = ((hours % 24) + 24) % 24
  }

  /** Advances time by `dt` real seconds, a full day lasting `dayLengthMin` real minutes. */
  advance(dt: number, dayLengthMin: number): void {
    this.setTime(this.time + (dt * 24) / (Math.max(0.1, dayLengthMin) * 60))
  }

  apply(out: SkyState): void {
    const angle = ((this.time - 6) / 24) * Math.PI * 2
    const e = Math.sin(angle)
    out.sunElevation = e

    // Sky gradient.
    let i = 0
    while (i < STOPS.length - 2 && e > (STOPS[i + 1] as Stop).e) i++
    const a = STOPS[i] as Stop
    const b = STOPS[i + 1] as Stop
    const t = Math.min(1, Math.max(0, (e - a.e) / (b.e - a.e)))
    out.sky.copy(a.sky).lerp(b.sky, t)
    out.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, t)
    out.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, t)
    out.hemiIntensity = a.hemi + (b.hemi - a.hemi) * t

    // Sun by day, moon (opposite side) by night, crossfading around the horizon.
    const sun = smoothstep(-0.04, 0.12, e)
    const moon = 1 - smoothstep(-0.12, -0.02, e)
    const sign = e >= -0.03 ? 1 : -1
    out.lightDir.set(Math.cos(angle) * sign, Math.abs(e) + 0.05, TILT).normalize()
    if (sign > 0) {
      out.lightColor.copy(SUN_LOW).lerp(SUN_DAY, smoothstep(0.05, 0.4, e))
      out.lightIntensity = sun * SUN_INTENSITY
    } else {
      out.lightColor.copy(MOON)
      out.lightIntensity = moon * MOON_INTENSITY
    }
  }
}

export function createSkyState(): SkyState {
  return {
    lightDir: new THREE.Vector3(0, 1, 0),
    lightColor: new THREE.Color(),
    lightIntensity: 1,
    sky: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 1,
    sunElevation: 1,
  }
}

/** "HH:MM" for the HUD. */
export function formatTime(hours: number): string {
  const total = Math.floor(hours * 60) % (24 * 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}
