import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Lamp, VehicleId, VehicleSpec } from './vehicleSpecs'

type Rgb = readonly [number, number, number]

const srgb = (hex: number): Rgb => {
  const c = new THREE.Color().setHex(hex) // converted to linear working space
  return [c.r, c.g, c.b]
}

const GLASS = srgb(0x27343d)
const DARK = srgb(0x2b2b2b)
const LIGHT = srgb(0xfff4c2)
const TAIL = srgb(0xb3261e)
const CHROME = srgb(0x9aa1a6)

/** Box part with a flat vertex color. Coordinates in chassis space (meters). */
function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: Rgb,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed()
  g.translate(x, y, z)
  g.deleteAttribute('uv')
  const count = g.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colors.set(color, i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return g
}

type Facing = '+x' | '-x' | '+z' | '-z'

/**
 * One-sided window pane facing outward: opaque from outside, invisible from the cabin
 * (back-face culled), so the first-person view looks through it.
 */
function pane(
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
  facing: Facing,
): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h).toNonIndexed() // faces +Z
  g.deleteAttribute('uv')
  if (facing === '-z') g.rotateY(Math.PI)
  else if (facing === '+x') g.rotateY(Math.PI / 2)
  else if (facing === '-x') g.rotateY(-Math.PI / 2)
  g.translate(x, y, z)
  const count = g.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colors.set(GLASS, i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return g
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  if (!merged) throw new Error('Failed to merge vehicle geometry')
  merged.computeBoundingSphere()
  return merged
}

/** Classic camper van: two-tone body, tall roof, sliding door line. Origin = chassis center. */
function vanParts(s: VehicleSpec): THREE.BufferGeometry[] {
  const [hx, hy, hz] = s.halfExtents
  const W = hx * 2
  const bottom = -hy
  const eyeY = s.driverEye[1]
  const cream = srgb(0xf1ead8)
  const teal = srgb(0x3f8f8a)
  const e = 0.01 // pane offset from body faces
  return [
    // Two-tone boxy body, underbody
    box(W, 0.7, hz * 2, 0, bottom + 0.6, 0, teal),
    box(W, 0.8, hz * 2, 0, bottom + 1.35, 0, cream),
    box(W - 0.3, 0.3, hz * 2 - 0.4, 0, bottom + 0.2, 0, DARK),
    // Windows: windshield, cab sides, rear-cabin sides, rear
    pane(W - 0.2, 0.5, 0, bottom + 1.35, -hz - e, '-z'),
    pane(0.9, 0.45, -hx - e, bottom + 1.38, -hz + 0.75, '-x'),
    pane(0.9, 0.45, hx + e, bottom + 1.38, -hz + 0.75, '+x'),
    pane(2.4, 0.4, -hx - e, bottom + 1.4, 0.55, '-x'),
    pane(2.4, 0.4, hx + e, bottom + 1.4, 0.55, '+x'),
    pane(W - 0.5, 0.4, 0, bottom + 1.4, hz + e, '+z'),
    // Dashboard and steering wheel (seen from the driver seat)
    box(W - 0.1, 0.3, 0.45, 0, eyeY - 0.5, -hz + 0.3, DARK),
    box(0.4, 0.4, 0.05, s.driverEye[0], eyeY - 0.4, -hz + 0.62, DARK),
    // Roof rack
    box(W - 0.3, 0.06, hz * 1.3, 0, bottom + 1.8, 0.4, DARK),
    // Bumpers, lights, grille
    box(W + 0.06, 0.2, 0.18, 0, bottom + 0.3, -hz - 0.05, CHROME),
    box(W + 0.06, 0.2, 0.18, 0, bottom + 0.3, hz + 0.05, CHROME),
    ...lampParts(s, 0, 1),
    box(0.9, 0.3, 0.04, 0, bottom + 0.6, -hz - 0.01, DARK),
  ]
}

/** Boxy off-roader: raised body, roof bars, spare wheel. Origin = chassis center. */
function offroadParts(s: VehicleSpec): THREE.BufferGeometry[] {
  const [hx, hy, hz] = s.halfExtents
  const W = hx * 2
  const bottom = -hy
  const olive = srgb(0x6b7444)
  const sand = srgb(0xd8c79a)
  return [
    box(W, 0.75, hz * 2, 0, bottom + 0.375, 0, olive),
    // Hood slightly lower than the cabin
    box(W - 0.06, 0.12, 1.3, 0, bottom + 0.81, -hz + 0.65, olive),
    // Cabin
    box(W - 0.06, 0.7, hz * 2 - 1.4, 0, bottom + 1.1, 0.7, sand),
    pane(W - 0.16, 0.5, 0, bottom + 1.12, -hz + 1.39, '-z'),
    pane(hz * 2 - 1.9, 0.42, -hx + 0.02, bottom + 1.15, 0.65, '-x'),
    pane(hz * 2 - 1.9, 0.42, hx - 0.02, bottom + 1.15, 0.65, '+x'),
    pane(W - 0.5, 0.36, 0, bottom + 1.18, hz + 0.01, '+z'),
    // Dashboard and steering wheel
    box(W - 0.2, 0.2, 0.35, 0, s.driverEye[1] - 0.4, -hz + 1.5, DARK),
    box(0.38, 0.38, 0.05, s.driverEye[0], s.driverEye[1] - 0.32, -hz + 1.75, DARK),
    // Roof bars
    box(0.06, 0.08, hz * 2 - 1.5, -hx + 0.15, bottom + 1.5, 0.7, DARK),
    box(0.06, 0.08, hz * 2 - 1.5, hx - 0.15, bottom + 1.5, 0.7, DARK),
    // Bull bar, bumpers, lights
    box(W + 0.1, 0.25, 0.2, 0, bottom + 0.1, -hz - 0.08, DARK),
    box(W - 0.4, 0.06, 0.06, 0, bottom + 0.6, -hz - 0.12, DARK),
    box(W + 0.1, 0.25, 0.2, 0, bottom + 0.1, hz + 0.08, DARK),
    ...lampParts(s, 0, 1),
    // Spare wheel
    box(0.7, 0.7, 0.25, 0, bottom + 0.75, hz + 0.18, DARK),
    // Wheel arches
    ...[s.frontZ, s.rearZ].flatMap((z) => [
      box(0.12, 0.2, 1.1, -hx - 0.03, bottom + 0.62, z, DARK),
      box(0.12, 0.2, 1.1, hx + 0.03, bottom + 0.62, z, DARK),
    ]),
  ]
}

/** Head and tail lamps, both sides. `out` pushes them outward (m), `glow` scales colors. */
function lampParts(s: VehicleSpec, out: number, glow: number): THREE.BufferGeometry[] {
  const lamp = ([x, y, z, w, h]: Lamp, color: Rgb, dir: number) => {
    const c: Rgb = [color[0] * glow, color[1] * glow, color[2] * glow]
    const zz = z + dir * out
    return [box(w, h, 0.04, -x, y, zz, c), box(w, h, 0.04, x, y, zz, c)]
  }
  return [...lamp(s.lamps.head, LIGHT, -1), ...lamp(s.lamps.tail, TAIL, 1)]
}

/** Emissive overlay drawn over the lamps when the lights are on (unlit material). */
export function buildLampGlowGeometry(spec: VehicleSpec): THREE.BufferGeometry {
  return merge(lampParts(spec, 0.01, 1.6))
}

export function buildVehicleGeometry(spec: VehicleSpec): THREE.BufferGeometry {
  const builders: Record<VehicleId, (s: VehicleSpec) => THREE.BufferGeometry[]> = {
    van: vanParts,
    offroad: offroadParts,
  }
  return merge(builders[spec.id](spec))
}

/** Unit wheel (radius 1, width 1) along the X axis: low-poly tyre + hub. */
export function buildWheelGeometry(): THREE.BufferGeometry {
  const tyre = new THREE.CylinderGeometry(1, 1, 1, 10).toNonIndexed()
  tyre.rotateZ(Math.PI / 2)
  tyre.deleteAttribute('uv')
  const hub = new THREE.CylinderGeometry(0.55, 0.55, 1.04, 6).toNonIndexed()
  hub.rotateZ(Math.PI / 2)
  hub.deleteAttribute('uv')
  const paint = (g: THREE.BufferGeometry, c: Rgb) => {
    const n = g.getAttribute('position').count
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) colors.set(c, i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g
  }
  return merge([paint(tyre, srgb(0x222222)), paint(hub, CHROME)])
}
