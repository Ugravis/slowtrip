import * as THREE from 'three'
import { CameraRig } from '../camera/CameraRig'
import { Character, type WalkControls } from '../character/Character'
import { Input } from '../core/input'
import type { QualitySettings } from '../core/quality'
import { useSettings } from '../core/settings'
import { Physics, type Rapier } from '../physics/physics'
import type { DriveControls, Vehicle } from '../vehicles/Vehicle'
import { OFFROAD, VAN } from '../vehicles/vehicleSpecs'
import { VehicleSystem } from '../vehicles/VehicleSystem'
import { WorldOrigin } from '../world/origin'
import { createSkyState, DayNight } from '../world/sky/dayNight'
import { BIOME_NAMES } from '../world/terrain/biomes'
import {
  createTerrainPoint,
  createWorldGen,
  type HeightSampler,
  type WorldGen,
} from '../world/terrain/heightSampler'
import { MapTileSource } from '../world/terrain/mapTiles'
import { bandOf } from '../world/road/roadNetwork'
import { roadSpot } from '../world/terrain/spawn'
import { TerrainSystem } from '../world/terrain/TerrainSystem'
import { Water } from '../world/water/Water'
import { CHUNK_SIZE } from '../world/constants'
import { useGameStore } from './store'

/** Teleports snap onto the road within this distance (m). */
const ROAD_SNAP = 400

/** Max distance (m) from a vehicle's side to get in. */
const ENTER_MARGIN = 1.6
/** Max speed (m/s) to get out of a vehicle. */
const EXIT_MAX_SPEED = 3
const MOUSE_SENSITIVITY = 0.0022
/** Sun elevation under which headlights switch on by themselves (and off above). */
const DUSK_ELEVATION = 0.06

const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _pt = createTerrainPoint()

/** World-space player pose for the UI (minimap, HUD). Doubles, not local coordinates. */
export interface PlayerPose {
  x: number
  y: number
  z: number
  /** Radians, forward = (-sin h, -cos h). */
  heading: number
}

/** Counters polled by the HUD. */
export interface GameStats {
  frames: number
  drawCalls: number
  triangles: number
}

/** Owns every simulation system. Plain TS: React only mounts `scene` objects and calls `update`. */
export class Game {
  readonly physics: Physics
  readonly origin = new WorldOrigin()
  readonly terrain: TerrainSystem
  readonly vehicles: VehicleSystem
  readonly character: Character
  readonly input = new Input()
  readonly cameraRig: CameraRig
  readonly quality: QualitySettings
  /** Main-thread copy of the world generator (spawn, camera clamping, HUD). Same seed as the workers. */
  readonly world: WorldGen
  readonly height: HeightSampler
  readonly water: Water
  /** Map tiles, generated on their own worker. */
  readonly mapTiles: MapTileSource
  readonly dayNight = new DayNight(10)
  readonly sky = createSkyState()
  readonly stats: GameStats = { frames: 0, drawCalls: 0, triangles: 0 }
  /** Vehicle currently driven by the player; null when on foot. */
  driven: Vehicle | null = null
  /** Headlights of the driven vehicle. Auto at dusk/dawn, `L` overrides until the next one. */
  headlights = false
  /** Handbrake of the driven vehicle, toggled (stays on until pressed again). */
  handbrake = false
  private dark = false
  /** Vehicle close enough to get in (on foot only). */
  private nearby: Vehicle | null = null

  private readonly drive: DriveControls = { throttle: 0, steer: 0, handbrake: false }
  private readonly walk: WalkControls = { x: 0, y: 0, sprint: false, jump: false }
  private readonly prePhysics = (dt: number) => {
    this.vehicles.step(dt, this.driven, this.drive)
    if (!this.driven && this.character.body.isEnabled()) {
      this.character.step(dt, this.walk)
      this.walk.jump = false
    }
  }

  constructor(
    rapier: Rapier,
    readonly seed: number,
    quality: QualitySettings,
    camera: THREE.PerspectiveCamera,
  ) {
    this.quality = quality
    this.physics = new Physics(rapier)
    this.world = createWorldGen(seed)
    this.height = this.world.height
    this.water = new Water(quality.viewRadius * CHUNK_SIZE * 2.4)
    this.mapTiles = new MapTileSource(seed)
    this.terrain = new TerrainSystem(seed, quality.viewRadius, this.physics, this.origin)
    this.vehicles = new VehicleSystem(this.physics, this.terrain)
    this.cameraRig = new CameraRig(camera, (x, z) => this.heightAtLocal(x, z))

    // Spawn bands are generated here once; later bands come from the terrain worker so the
    // main thread never runs the road search during play.
    const roads = this.world.roads
    roads.band(-1)
    roads.band(0)
    roads.generate = false
    roads.onMissing = (k) => {
      void this.terrain.roadBand(k).then((d) => roads.insert(k, d))
    }
    // Van in the northbound lane, the off-roader parked on the shoulder behind it.
    const van = roadSpot(roads, 0, 1.75)
    this.vehicles.add(VAN, van.x, this.heightAtLocal(van.x, van.z) + 2, van.z, van.yaw)
    const off = roadSpot(roads, 14, 4.8)
    this.vehicles.add(OFFROAD, off.x, this.heightAtLocal(off.x, off.z) + 2, off.z, off.yaw)
    // Start on foot, behind the van.
    const me = roadSpot(roads, 8, 1.75)
    this.character = new Character(this.physics, me.x, this.heightAtLocal(me.x, me.z) + 0.5, me.z)
    this.character.setActive(false)
    useGameStore.getState().setMode('onFoot')
    this.dayNight.apply(this.sky)
    this.dark = this.sky.sunElevation < DUSK_ELEVATION
    this.setHeadlights(this.dark)
  }

  setHeadlights(on: boolean): void {
    this.headlights = on
    useGameStore.getState().setHeadlights(on)
  }

  setHandbrake(on: boolean): void {
    this.handbrake = on
    this.drive.handbrake = on
    useGameStore.getState().setHandbrake(on)
  }

  /** Height of the terrain at a local position. */
  heightAtLocal(lx: number, lz: number): number {
    return this.height(lx + this.origin.x, lz + this.origin.z)
  }

  /** Biome name at a world position (HUD). */
  biomeAt(x: number, z: number): string {
    return BIOME_NAMES[this.world.sample(x, z, _pt).biome] ?? ''
  }

  /** Dev: marks every chunk within `radius` chunks of the player as explored (full map audit). */
  revealAround(radius: number): void {
    const t = this.driven ? this.driven.body.translation() : this.character.body.translation()
    this.terrain.reveal(
      Math.floor((t.x + this.origin.x) / CHUNK_SIZE),
      Math.floor((t.z + this.origin.z) / CHUNK_SIZE),
      radius,
    )
  }

  /**
   * Dev: moves the player, with the driven vehicle, to world (x, z). Snaps onto the road's
   * northbound lane when it is within ROAD_SNAP meters. The vehicle waits, frozen, for its
   * terrain collider (see VehicleSystem.updateEnabled).
   */
  teleport(x: number, z: number): void {
    const spot = this.world.roads.closestSpot(x, z, ROAD_SNAP, 1.75)
    const tx = (spot ? spot.x : x) - this.origin.x
    const tz = (spot ? spot.z : z) - this.origin.z
    const ground = this.heightAtLocal(tx, tz)
    if (this.driven) {
      const q = this.driven.body.rotation()
      const yaw = spot ? spot.yaw : 2 * Math.atan2(q.y, q.w)
      this.driven.place(tx, ground, tz, yaw)
      this.driven.body.setEnabled(false)
      this.vehicles.resetInterpolation()
    } else {
      this.character.body.setTranslation({ x: tx, y: ground + 1, z: tz }, true)
      this.character.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      this.character.setActive(false)
      this.character.resetInterpolation()
    }
    this.cameraRig.reset()
  }

  /** Speed of the driven vehicle in km/h (0 on foot). */
  get speedKmh(): number {
    const kmh = this.driven ? Math.abs(this.driven.speed) * 3.6 : 0
    return kmh < 1 ? 0 : kmh
  }

  /** Contextual action hint for the HUD, or null. */
  get hint(): string | null {
    if (this.driven) {
      return Math.abs(this.driven.speed) > EXIT_MAX_SPEED
        ? null
        : `E · Get out of the ${this.driven.spec.name}`
    }
    return this.nearby ? `E · Drive the ${this.nearby.spec.name}` : null
  }

  /** Records the last frame's renderer counters (HUD). */
  recordRender(drawCalls: number, triangles: number): void {
    this.stats.drawCalls = drawCalls
    this.stats.triangles = triangles
  }

  /** Writes the player's world pose into `out`. */
  pose(out: PlayerPose): void {
    const entity = this.driven && this.vehicles.entityOf(this.driven)
    if (entity) {
      const p = entity.mesh.position
      out.x = p.x + this.origin.x
      out.y = p.y
      out.z = p.z + this.origin.z
      _v.set(0, 0, -1).applyQuaternion(entity.mesh.quaternion)
      out.heading = Math.atan2(-_v.x, -_v.z)
      return
    }
    const t = this.character.body.translation()
    out.x = t.x + this.origin.x
    out.y = t.y
    out.z = t.z + this.origin.z
    out.heading = this.character.yaw
  }

  update(dt: number): void {
    const input = this.input
    input.poll()
    this.stats.frames++

    const settings = useSettings.getState()
    if (!settings.timePaused) this.dayNight.advance(dt, settings.dayLengthMin)
    this.dayNight.apply(this.sky)
    const dark = this.sky.sunElevation < DUSK_ELEVATION
    if (dark !== this.dark) {
      this.dark = dark
      this.setHeadlights(dark)
    }
    this.cameraRig.baseFov = settings.fov
    const lookX = input.look.x * settings.lookSensitivity
    const lookY = input.look.y * settings.lookSensitivity * (settings.invertY ? -1 : 1)

    if (this.driven) this.updateDriving(this.driven)
    else this.updateOnFoot(lookX, lookY)

    this.vehicles.updateEnabled()
    const c = this.character.body.translation()
    if (!this.driven) {
      const ground = this.terrain.hasColliderAt(c.x, c.z)
      if (ground !== this.character.body.isEnabled()) this.character.setActive(ground)
    }

    const alpha = this.physics.update(dt, this.prePhysics)
    this.vehicles.sync(alpha)
    this.vehicles.setHeadlights(this.driven, this.headlights)

    const driven = this.driven
    const entity = driven && this.vehicles.entityOf(driven)
    if (entity) {
      this.cameraRig.vehicle(
        entity.mesh,
        entity.vehicle.spec,
        entity.vehicle.speed,
        lookX,
        lookY,
        dt,
      )
    } else {
      this.cameraRig.character(this.character, alpha, dt)
    }

    const focus = this.driven ? this.driven.body.translation() : this.character.body.translation()
    this.terrain.update(focus.x, focus.z)
    // Request the road bands around the player ahead of time (no-op once cached).
    const band = bandOf(focus.z + this.origin.z)
    for (let k = band - 1; k <= band + 1; k++) this.world.roads.band(k)
    const shift = this.origin.rebaseFor(focus.x, focus.z)
    if (shift) {
      this.origin.apply(shift.dx, shift.dz)
      this.physics.shift(shift.dx, shift.dz)
      this.terrain.onOriginShift()
      this.cameraRig.shift(shift.dx, shift.dz)
      this.vehicles.resetInterpolation()
      this.character.resetInterpolation()
    }
    this.water.follow(focus.x - (shift?.dx ?? 0), focus.z - (shift?.dz ?? 0))

    input.endFrame()
  }

  private updateOnFoot(lookX: number, lookY: number): void {
    const input = this.input
    this.character.look(-lookX * MOUSE_SENSITIVITY, -lookY * MOUSE_SENSITIVITY)
    this.walk.x = input.move.x
    this.walk.y = input.move.y
    this.walk.sprint = input.sprint
    if (input.consume('jump')) this.walk.jump = true

    this.nearby = this.findNearbyVehicle()
    if (this.nearby && input.consume('interact')) this.enter(this.nearby)
  }

  private updateDriving(vehicle: Vehicle): void {
    const input = this.input
    this.drive.throttle = input.move.y
    this.drive.steer = input.move.x
    if (input.consume('handbrake')) this.setHandbrake(!this.handbrake)
    if (input.consume('headlights')) this.setHeadlights(!this.headlights)
    if (input.consume('reset')) {
      const t = vehicle.body.translation()
      vehicle.resetUpright(this.heightAtLocal(t.x, t.z))
      this.vehicles.resetInterpolation()
    }
    if (input.consume('interact') && Math.abs(vehicle.speed) <= EXIT_MAX_SPEED) this.exit(vehicle)
    if (input.consume('toggleView')) useGameStore.getState().setView(this.cameraRig.toggleView())
  }

  private findNearbyVehicle(): Vehicle | null {
    const c = this.character.body.translation()
    let best: Vehicle | null = null
    let bestDist = Infinity
    for (const { vehicle } of this.vehicles.entities) {
      const t = vehicle.body.translation()
      const d = Math.hypot(t.x - c.x, t.z - c.z)
      const reach = vehicle.spec.halfExtents[2] + ENTER_MARGIN
      if (d < reach && d < bestDist) {
        best = vehicle
        bestDist = d
      }
    }
    return best
  }

  private enter(vehicle: Vehicle): void {
    this.cameraRig.reset()
    this.driven = vehicle
    this.nearby = null
    this.character.setActive(false)
    this.setHandbrake(false)
    vehicle.body.wakeUp()
    useGameStore.getState().setMode('driving')
  }

  private exit(vehicle: Vehicle): void {
    this.cameraRig.reset()
    // Step out on the driver's side (left), next to the door.
    const spec = vehicle.spec
    const r = vehicle.body.rotation()
    const t = vehicle.body.translation()
    _q.set(r.x, r.y, r.z, r.w)
    _v.set(-(spec.halfExtents[0] + 0.8), 0, spec.driverEye[2]).applyQuaternion(_q)
    const x = t.x + _v.x
    const z = t.z + _v.z
    _v.set(0, 0, -1).applyQuaternion(_q)
    const yaw = Math.atan2(-_v.x, -_v.z)
    this.character.placeAt(x, this.heightAtLocal(x, z), z, yaw)
    this.character.setActive(true)
    this.driven = null
    useGameStore.getState().setMode('onFoot')
  }

  dispose(): void {
    this.input.dispose()
    this.character.dispose()
    this.vehicles.dispose()
    this.terrain.dispose()
    this.water.dispose()
    this.mapTiles.dispose()
    this.physics.dispose()
  }
}
