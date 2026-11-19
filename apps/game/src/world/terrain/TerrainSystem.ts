import type RAPIER from '@dimforge/rapier3d'
import { wrap, type Remote } from 'comlink'
import * as THREE from 'three'
import type { Physics } from '../../physics/physics'
import { CHUNK_SIZE, COLLIDER_RING, lodResolution, PHYSICS_RES } from '../constants'
import type { WorldOrigin } from '../origin'
import type { ChunkMeshData } from './chunkMesh'
import type { TerrainWorkerApi } from './terrain.worker'

const MAX_IN_FLIGHT = 4

interface Chunk {
  key: string
  cx: number
  cz: number
  ring: number
  mesh: THREE.Mesh | null
  meshRes: number
  pendingRes: number
  body: RAPIER.RigidBody | null
  colliderPending: boolean
}

interface Job {
  chunk: Chunk
  kind: 'mesh' | 'collider'
  dist2: number
}

const chunkKey = (cx: number, cz: number) => `${cx},${cz}`

/**
 * Streams terrain chunks around the player: meshes with LOD rings (generated in a worker)
 * and heightfield colliders only for the nearest ring.
 */
const PACK_OFFSET = 2 ** 20
const PACK_SPAN = 2 ** 21

/** Packs chunk coordinates (±1M chunks) into one exact number key. */
export function packChunk(cx: number, cz: number): number {
  return (cx + PACK_OFFSET) * PACK_SPAN + (cz + PACK_OFFSET)
}

export function unpackChunkX(key: number): number {
  return Math.floor(key / PACK_SPAN) - PACK_OFFSET
}

export function unpackChunkZ(key: number): number {
  return (key % PACK_SPAN) - PACK_OFFSET
}

export class TerrainSystem {
  readonly group = new THREE.Group()
  /** Chunks the player has been close enough to load (packed keys). Session only, grows slowly. */
  readonly explored = new Set<number>()
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true })
  private readonly chunks = new Map<string, Chunk>()
  private readonly worker: Worker
  private readonly api: Remote<TerrainWorkerApi>
  private readonly ready: Promise<void>
  private centerX = Number.NaN
  private centerZ = Number.NaN
  private jobs: Job[] = []
  private inFlight = 0
  private disposed = false

  constructor(
    seed: number,
    private readonly viewRadius: number,
    private readonly physics: Physics,
    private readonly origin: WorldOrigin,
  ) {
    this.group.name = 'terrain'
    this.worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' })
    this.api = wrap<TerrainWorkerApi>(this.worker)
    this.ready = this.api.init(seed)
  }

  /** Call every frame with the player's local position. Cheap unless the player changed chunk. */
  update(localX: number, localZ: number): void {
    const cx = Math.floor((localX + this.origin.x) / CHUNK_SIZE)
    const cz = Math.floor((localZ + this.origin.z) / CHUNK_SIZE)
    if (cx !== this.centerX || cz !== this.centerZ) {
      this.centerX = cx
      this.centerZ = cz
      this.refresh()
    }
    this.pump()
  }

  /** Loaded chunk count (HUD). */
  get loadedChunks(): number {
    return this.chunks.size
  }

  /** True when the chunk containing this local position has a physics collider. */
  hasColliderAt(localX: number, localZ: number): boolean {
    const cx = Math.floor((localX + this.origin.x) / CHUNK_SIZE)
    const cz = Math.floor((localZ + this.origin.z) / CHUNK_SIZE)
    return this.chunks.get(chunkKey(cx, cz))?.body != null
  }

  /** Marks chunks within `radius` of (cx, cz) as explored, without loading them (map only). */
  reveal(cx: number, cz: number, radius: number): void {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dz * dz <= radius * radius) this.explored.add(packChunk(cx + dx, cz + dz))
      }
    }
  }

  /** Repositions meshes after the floating origin moved. Physics bodies are shifted by Physics. */
  onOriginShift(): void {
    for (const chunk of this.chunks.values()) {
      if (chunk.mesh) this.placeMesh(chunk.mesh, chunk.cx, chunk.cz)
    }
  }

  private refresh(): void {
    const r = this.viewRadius
    const keep = r + 1 // hysteresis: unload one ring later than load
    for (const chunk of this.chunks.values()) {
      const dx = chunk.cx - this.centerX
      const dz = chunk.cz - this.centerZ
      if (dx * dx + dz * dz > keep * keep) this.unload(chunk)
      else chunk.ring = Math.max(Math.abs(dx), Math.abs(dz))
    }
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dz * dz > r * r) continue
        const cx = this.centerX + dx
        const cz = this.centerZ + dz
        const key = chunkKey(cx, cz)
        if (this.chunks.has(key)) continue
        this.explored.add(packChunk(cx, cz))
        this.chunks.set(key, {
          key,
          cx,
          cz,
          ring: Math.max(Math.abs(dx), Math.abs(dz)),
          mesh: null,
          meshRes: 0,
          pendingRes: 0,
          body: null,
          colliderPending: false,
        })
      }
    }
    // Drop colliders that left the collider ring.
    for (const chunk of this.chunks.values()) {
      if (chunk.body && chunk.ring > COLLIDER_RING + 1) {
        this.physics.world.removeRigidBody(chunk.body)
        chunk.body = null
      }
    }
    this.rebuildJobs()
  }

  private rebuildJobs(): void {
    const jobs: Job[] = []
    for (const chunk of this.chunks.values()) {
      const dx = chunk.cx - this.centerX
      const dz = chunk.cz - this.centerZ
      const dist2 = dx * dx + dz * dz
      const res = lodResolution(chunk.ring)
      if (chunk.meshRes !== res && chunk.pendingRes === 0) jobs.push({ chunk, kind: 'mesh', dist2 })
      if (chunk.ring <= COLLIDER_RING && !chunk.body && !chunk.colliderPending) {
        // Colliders first: the player must never stand on missing ground.
        jobs.push({ chunk, kind: 'collider', dist2: dist2 - 1000 })
      }
    }
    jobs.sort((a, b) => b.dist2 - a.dist2) // nearest last, popped first
    this.jobs = jobs
  }

  private pump(): void {
    while (this.inFlight < MAX_IN_FLIGHT && this.jobs.length > 0) {
      const job = this.jobs.pop() as Job
      if (!this.chunks.has(job.chunk.key)) continue
      if (job.kind === 'mesh') this.requestMesh(job.chunk)
      else this.requestCollider(job.chunk)
    }
  }

  private requestMesh(chunk: Chunk): void {
    const res = lodResolution(chunk.ring)
    if (chunk.meshRes === res) return
    chunk.pendingRes = res
    this.inFlight++
    const skirt = (CHUNK_SIZE / res) * 1.5
    void this.ready
      .then(() => this.api.mesh(chunk.cx, chunk.cz, res, skirt))
      .then((data) => {
        this.inFlight--
        chunk.pendingRes = 0
        if (this.disposed || this.chunks.get(chunk.key) !== chunk) return
        this.setMesh(chunk, data, res)
        // LOD may have changed while generating.
        if (lodResolution(chunk.ring) !== res) this.rebuildJobs()
      })
  }

  private requestCollider(chunk: Chunk): void {
    chunk.colliderPending = true
    this.inFlight++
    void this.ready
      .then(() => this.api.heights(chunk.cx, chunk.cz, PHYSICS_RES))
      .then((heights) => {
        this.inFlight--
        chunk.colliderPending = false
        if (this.disposed || this.chunks.get(chunk.key) !== chunk) return
        if (chunk.ring > COLLIDER_RING + 1 || chunk.body) return
        this.createCollider(chunk, heights)
      })
  }

  private setMesh(chunk: Chunk, data: ChunkMeshData, res: number): void {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
    const half = CHUNK_SIZE / 2
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(-half, data.minY, -half),
      new THREE.Vector3(half, data.maxY, half),
    )
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere())

    if (chunk.mesh) {
      chunk.mesh.geometry.dispose()
      chunk.mesh.geometry = geometry
    } else {
      const mesh = new THREE.Mesh(geometry, this.material)
      mesh.matrixAutoUpdate = false
      this.placeMesh(mesh, chunk.cx, chunk.cz)
      chunk.mesh = mesh
      this.group.add(mesh)
    }
    chunk.meshRes = res
  }

  private createCollider(chunk: Chunk, heights: Float32Array): void {
    const { rapier, world } = this.physics
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(
        (chunk.cx + 0.5) * CHUNK_SIZE - this.origin.x,
        0,
        (chunk.cz + 0.5) * CHUNK_SIZE - this.origin.z,
      ),
    )
    world.createCollider(
      rapier.ColliderDesc.heightfield(PHYSICS_RES, PHYSICS_RES, heights, {
        x: CHUNK_SIZE,
        y: 1,
        z: CHUNK_SIZE,
      }).setFriction(1),
      body,
    )
    chunk.body = body
  }

  private placeMesh(mesh: THREE.Mesh, cx: number, cz: number): void {
    mesh.position.set(
      (cx + 0.5) * CHUNK_SIZE - this.origin.x,
      0,
      (cz + 0.5) * CHUNK_SIZE - this.origin.z,
    )
    mesh.updateMatrix()
  }

  private unload(chunk: Chunk): void {
    if (chunk.mesh) {
      chunk.mesh.geometry.dispose()
      this.group.remove(chunk.mesh)
      chunk.mesh = null
    }
    if (chunk.body) {
      this.physics.world.removeRigidBody(chunk.body)
      chunk.body = null
    }
    this.chunks.delete(chunk.key)
  }

  dispose(): void {
    this.disposed = true
    for (const chunk of [...this.chunks.values()]) this.unload(chunk)
    this.material.dispose()
    this.worker.terminate()
  }
}
