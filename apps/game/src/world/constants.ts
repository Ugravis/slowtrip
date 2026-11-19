/** Edge length of a terrain chunk, in meters. */
export const CHUNK_SIZE = 64

/** Grid resolution (cells per edge) of physics heightfields and the nearest mesh LOD. */
export const PHYSICS_RES = 32

/** Mesh resolution by Chebyshev ring distance from the player chunk. */
export function lodResolution(ring: number): number {
  if (ring <= 1) return 32
  if (ring <= 3) return 16
  return 8
}

/** Chunks within this ring around the player get a physics collider. */
export const COLLIDER_RING = 1

/** Recenter the world when the player is farther than this from the local origin (meters). */
export const ORIGIN_REBASE_DISTANCE = 4 * CHUNK_SIZE

/** Height of the water surface (lakes), in meters. */
export const WATER_LEVEL = 0
