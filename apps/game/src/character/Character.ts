import type RAPIER from '@dimforge/rapier3d-compat'
import type { Physics } from '../physics/physics'

export const EYE_HEIGHT = 1.65
const RADIUS = 0.35
const HALF_HEIGHT = 0.55 // capsule: 2 * (HALF_HEIGHT + RADIUS) = 1.8 m
const WALK_SPEED = 4
const SPRINT_SPEED = 7.5
const JUMP_SPEED = 5
const GRAVITY = 18
const ACCEL = 12
const MAX_PITCH = 1.45

export interface WalkControls {
  /** Strafe right (+) / left (-), in [-1, 1]. */
  x: number
  /** Forward (+) / backward (-), in [-1, 1]. */
  y: number
  sprint: boolean
  jump: boolean
}

/**
 * First-person walker: kinematic capsule driven by Rapier's character controller.
 * Position = capsule center. Yaw 0 looks toward -Z.
 */
export class Character {
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider
  private readonly controller: RAPIER.KinematicCharacterController
  yaw = 0
  pitch = 0
  private vx = 0
  private vz = 0
  private vy = 0
  grounded = false
  private readonly delta = { x: 0, y: 0, z: 0 }
  private readonly next = { x: 0, y: 0, z: 0 }
  private readonly moved = { x: 0, y: 0, z: 0 }

  constructor(
    private readonly physics: Physics,
    x: number,
    feetY: number,
    z: number,
  ) {
    const { rapier, world } = physics
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
        x,
        feetY + HALF_HEIGHT + RADIUS,
        z,
      ),
    )
    this.collider = world.createCollider(
      rapier.ColliderDesc.capsule(HALF_HEIGHT, RADIUS),
      this.body,
    )
    const c = world.createCharacterController(0.02)
    c.setUp({ x: 0, y: 1, z: 0 })
    c.setMaxSlopeClimbAngle((50 * Math.PI) / 180)
    c.setMinSlopeSlideAngle((55 * Math.PI) / 180)
    c.enableAutostep(0.45, 0.2, false)
    c.enableSnapToGround(0.4)
    c.setApplyImpulsesToDynamicBodies(true)
    c.setCharacterMass(80)
    this.controller = c
  }

  /** Eye height above the capsule center. */
  static readonly EYE_OFFSET = EYE_HEIGHT - (HALF_HEIGHT + RADIUS)

  /** Applies a look delta in radians. */
  look(dYaw: number, dPitch: number): void {
    this.yaw += dYaw
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + dPitch))
  }

  /** Moves the capsule. Call before each physics step. */
  step(dt: number, controls: WalkControls): void {
    const speed = controls.sprint ? SPRINT_SPEED : WALK_SPEED
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    let ix = controls.x
    let iy = controls.y
    const len = Math.hypot(ix, iy)
    if (len > 1) {
      ix /= len
      iy /= len
    }
    // forward = (-sin, -cos), right = (cos, -sin)
    const tx = (ix * cos - iy * sin) * speed
    const tz = (-ix * sin - iy * cos) * speed
    const k = Math.min(1, dt * (this.grounded ? ACCEL : ACCEL * 0.25))
    this.vx += (tx - this.vx) * k
    this.vz += (tz - this.vz) * k

    if (this.grounded) {
      this.vy = controls.jump ? JUMP_SPEED : -1
    } else {
      this.vy -= GRAVITY * dt
    }

    this.delta.x = this.vx * dt
    this.delta.y = this.vy * dt
    this.delta.z = this.vz * dt
    this.controller.computeColliderMovement(this.collider, this.delta)
    const m = this.controller.computedMovement(this.moved)
    this.grounded = this.controller.computedGrounded()
    if (this.grounded && this.vy > 0 && m.y < this.delta.y * 0.5) this.vy = 0

    const t = this.body.translation()
    this.next.x = t.x + m.x
    this.next.y = t.y + m.y
    this.next.z = t.z + m.z
    this.body.setNextKinematicTranslation(this.next)
  }

  /** Teleports the capsule so its feet stand at (x, feetY, z). */
  placeAt(x: number, feetY: number, z: number, yaw: number): void {
    this.body.setTranslation({ x, y: feetY + HALF_HEIGHT + RADIUS + 0.05, z }, true)
    this.body.setNextKinematicTranslation({ x, y: feetY + HALF_HEIGHT + RADIUS + 0.05, z })
    this.yaw = yaw
    this.pitch = 0
    this.vx = 0
    this.vy = 0
    this.vz = 0
  }

  setActive(active: boolean): void {
    this.body.setEnabled(active)
  }

  dispose(): void {
    this.physics.world.removeCharacterController(this.controller)
    this.physics.world.removeRigidBody(this.body)
  }
}
