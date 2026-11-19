import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { VehicleId, VehicleSpec } from './vehicleSpecs'

type Rgb = readonly [number, number, number]

const srgb = (hex: number): Rgb => {
  const c = new THREE.Color().setHex(hex) // converted to linear working space
  return [c.r, c.g, c.b]
}

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

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  if (!merged) throw new Error('Failed to merge vehicle geometry')
  merged.computeBoundingSphere()
  return merged
}

const GLASS = srgb(0x27343d)
const DARK = srgb(0x2b2b2b)
const LIGHT = srgb(0xfff4c2)
const TAIL = srgb(0xb3261e)
const CHROME = srgb(0x9aa1a6)

/** Classic camper van: two-tone body, tall roof, sliding door line. Origin = chassis center. */
function vanParts(s: VehicleSpec): THREE.BufferGeometry[] {
  const [hx, hy, hz] = s.halfExtents
  const W = hx * 2
  const bottom = -hy
  const cream = srgb(0xf1ead8)
  const teal = srgb(0x3f8f8a)
  return [
    // Lower body (teal) and upper body (cream)
    box(W, 0.7, hz * 2, 0, bottom + 0.6, 0, teal),
    box(W - 0.3, 0.3, hz * 2 - 0.4, 0, bottom + 0.2, 0, DARK),
    box(W, 0.8, hz * 2 - 0.9, 0, bottom + 1.35, 0.45, cream),
    // Cab (sloped look with a shorter upper block)
    box(W - 0.04, 0.55, 0.7, 0, bottom + 1.22, -hz + 0.6, cream),
    // Windshield and side windows
    box(W - 0.2, 0.5, 0.04, 0, bottom + 1.22, -hz + 0.24, GLASS),
    box(W + 0.02, 0.42, 1.0, 0, bottom + 1.3, -hz + 1.2, GLASS),
    box(W + 0.02, 0.38, 1.6, 0, bottom + 1.36, 0.6, GLASS),
    // Roof rack
    box(W - 0.3, 0.06, hz * 1.3, 0, bottom + 1.8, 0.4, DARK),
    // Bumpers, lights
    box(W + 0.06, 0.2, 0.18, 0, bottom + 0.3, -hz - 0.05, CHROME),
    box(W + 0.06, 0.2, 0.18, 0, bottom + 0.3, hz + 0.05, CHROME),
    box(0.26, 0.16, 0.04, -hx + 0.25, bottom + 0.6, -hz - 0.01, LIGHT),
    box(0.26, 0.16, 0.04, hx - 0.25, bottom + 0.6, -hz - 0.01, LIGHT),
    box(0.16, 0.3, 0.04, -hx + 0.15, bottom + 0.75, hz + 0.01, TAIL),
    box(0.16, 0.3, 0.04, hx - 0.15, bottom + 0.75, hz + 0.01, TAIL),
    // Grille
    box(0.9, 0.3, 0.04, 0, bottom + 0.55, -hz - 0.01, DARK),
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
    box(W - 0.16, 0.55, 0.04, 0, bottom + 1.12, -hz + 1.38, GLASS),
    box(W - 0.02, 0.45, hz * 2 - 1.8, 0, bottom + 1.15, 0.6, GLASS),
    // Roof bars
    box(0.06, 0.08, hz * 2 - 1.5, -hx + 0.15, bottom + 1.5, 0.7, DARK),
    box(0.06, 0.08, hz * 2 - 1.5, hx - 0.15, bottom + 1.5, 0.7, DARK),
    // Bull bar, bumpers, lights
    box(W + 0.1, 0.25, 0.2, 0, bottom + 0.1, -hz - 0.08, DARK),
    box(W - 0.4, 0.06, 0.06, 0, bottom + 0.6, -hz - 0.12, DARK),
    box(W + 0.1, 0.25, 0.2, 0, bottom + 0.1, hz + 0.08, DARK),
    box(0.22, 0.22, 0.04, -hx + 0.3, bottom + 0.55, -hz - 0.01, LIGHT),
    box(0.22, 0.22, 0.04, hx - 0.3, bottom + 0.55, -hz - 0.01, LIGHT),
    box(0.14, 0.24, 0.04, -hx + 0.12, bottom + 0.55, hz + 0.01, TAIL),
    box(0.14, 0.24, 0.04, hx - 0.12, bottom + 0.55, hz + 0.01, TAIL),
    // Spare wheel
    box(0.7, 0.7, 0.25, 0, bottom + 0.75, hz + 0.18, DARK),
    // Wheel arches
    ...[s.frontZ, s.rearZ].flatMap((z) => [
      box(0.12, 0.2, 1.1, -hx - 0.03, bottom + 0.62, z, DARK),
      box(0.12, 0.2, 1.1, hx + 0.03, bottom + 0.62, z, DARK),
    ]),
  ]
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
