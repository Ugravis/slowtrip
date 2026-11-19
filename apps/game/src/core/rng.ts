/** Seeded PRNG (mulberry32). Returns floats in [0, 1). Never use Math.random() in generation. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer hash of (seed, x, z) to a float in [0, 1). Stable across runs and platforms. */
export function hash2(seed: number, x: number, z: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Parses a seed from a string (e.g. URL param). Numeric strings are used as-is, others are hashed. */
export function parseSeed(value: string | null, fallback: number): number {
  if (!value) return fallback
  const n = Number(value)
  if (Number.isInteger(n)) return n >>> 0
  let h = 2166136261
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619)
  return h >>> 0
}
