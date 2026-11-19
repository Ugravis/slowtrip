import type RAPIER from '@dimforge/rapier3d'
import type { Physics } from '../physics/physics'
import type { VehicleSpec } from './vehicleSpecs'

export interface DriveControls {
  /** -1 (reverse / brake) .. 1 (accelerate). */
  throttle: number
  /** -1 (left) .. 1 (right). */
  steer: number
  handbrake: boolean
}

const STEER_RATE = 5
const ROLLING_BRAKE = 0.04

/**
 * Raycast vehicle on a Rapier dynamic body. Pure simulation, no rendering.
 * Chassis local frame: -Z forward, +Y up.
 */
export class Vehicle {
  readonly body: RAPIER.RigidBody
  readonly controller: RAPIER.DynamicRayCastVehicleController
  private steer = 0

  constructor(
    private readonly physics: Physics,
    readonly spec: VehicleSpec,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ) {
    const { rapier, world } = physics
    const [hx, hy, hz] = spec.halfExtents
    const half = yaw / 2
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) })
        .setLinearDamping(0.05)
        .setAngularDamping(0.6)
        .setCanSleep(true),
    )
    const m = spec.mass
    world.createCollider(
      rapier.ColliderDesc.cuboid(hx, hy, hz)
        .setMassProperties(
          m,
          { x: 0, y: spec.centerOfMassY, z: 0 },
          {
            x: (m / 3) * (hy * hy + hz * hz),
            y: (m / 3) * (hx * hx + hz * hz),
            z: (m / 3) * (hx * hx + hy * hy),
          },
          { x: 0, y: 0, z: 0, w: 1 },
        )
        .setFriction(0.4),
      this.body,
    )

    const c = world.createVehicleController(this.body)
    c.indexUpAxis = 1
    c.setIndexForwardAxis = 2
    const down = { x: 0, y: -1, z: 0 }
    const axle = { x: -1, y: 0, z: 0 }
    for (const z of [spec.frontZ, spec.rearZ]) {
      for (const side of [-1, 1]) {
        c.addWheel(
          { x: side * spec.track, y: spec.wheelY, z },
          down,
          axle,
          spec.suspensionRest,
          spec.wheelRadius,
        )
      }
    }
    for (let i = 0; i < 4; i++) {
      c.setWheelSuspensionStiffness(i, spec.suspensionStiffness)
      c.setWheelSuspensionCompression(i, spec.suspensionCompression)
      c.setWheelSuspensionRelaxation(i, spec.suspensionRelaxation)
      c.setWheelMaxSuspensionTravel(i, spec.suspensionTravel)
      c.setWheelMaxSuspensionForce(i, spec.mass * 40)
      c.setWheelFrictionSlip(i, spec.frictionSlip)
      c.setWheelSideFrictionStiffness(i, spec.sideFrictionStiffness)
    }
    this.controller = c
  }

  /** Signed forward speed in m/s (positive = forward). */
  get speed(): number {
    if (this.body.isSleeping() || !this.body.isEnabled()) return 0
    return -this.controller.currentVehicleSpeed()
  }

  /** Wheel index layout: 0 front-left, 1 front-right, 2 rear-left, 3 rear-right. */
  static readonly WHEEL_COUNT = 4

  /** Applies controls and updates the raycast wheels. Call before each physics step. */
  step(dt: number, controls: DriveControls | null): void {
    if (!this.body.isEnabled()) return
    const c = this.controller
    const s = this.spec
    const v = this.speed

    let engine = 0
    let brake = ROLLING_BRAKE
    let targetSteer = 0
    let rearBrake = 0

    if (controls) {
      const t = controls.throttle
      if (t !== 0 || controls.steer !== 0) this.body.wakeUp()
      if (t > 0) {
        if (v < -0.5) brake = s.brakeForce * t
        else if (v < s.maxSpeed) engine = s.engineForce * t
      } else if (t < 0) {
        if (v > 0.5) brake = s.brakeForce * -t
        else if (v > -s.maxReverseSpeed) engine = s.engineForce * 0.6 * t
      }
      if (controls.handbrake) {
        // Parking brake: no drive, rear wheels locked, and held still once stopped.
        engine = 0
        rearBrake = s.brakeForce
        if (Math.abs(v) < 1) brake = s.brakeForce
      }
      // Less steering at speed for stability.
      const speedFactor = 1 - 0.65 * Math.min(1, Math.abs(v) / 28)
      targetSteer = -controls.steer * s.maxSteer * speedFactor
    } else {
      brake = s.brakeForce
    }

    this.steer += (targetSteer - this.steer) * Math.min(1, dt * STEER_RATE)

    // Engine force sign: the controller's forward axis is +Z, ours is -Z.
    const force = -engine
    const awd = s.drivetrain === 'awd'
    const front = awd ? force / 4 : 0
    const rear = awd ? force / 4 : force / 2
    c.setWheelEngineForce(0, front)
    c.setWheelEngineForce(1, front)
    c.setWheelEngineForce(2, rear)
    c.setWheelEngineForce(3, rear)
    c.setWheelSteering(0, this.steer)
    c.setWheelSteering(1, this.steer)
    c.setWheelBrake(0, brake)
    c.setWheelBrake(1, brake)
    c.setWheelBrake(2, Math.max(brake, rearBrake))
    c.setWheelBrake(3, Math.max(brake, rearBrake))

    c.updateVehicle(dt)
  }

  /** Puts the vehicle back on its wheels at `groundY`, keeping its heading. */
  resetUpright(groundY: number): void {
    const t = this.body.translation()
    const q = this.body.rotation()
    // Heading from the rotated forward vector (-Z).
    const fx = -2 * (q.x * q.z + q.w * q.y)
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y))
    const yaw = Math.atan2(-fx, -fz)
    const half = yaw / 2
    this.body.setTranslation({ x: t.x, y: groundY + this.spec.halfExtents[1] + 1.2, z: t.z }, true)
    this.body.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  }

  dispose(): void {
    this.physics.world.removeVehicleController(this.controller)
    this.physics.world.removeRigidBody(this.body)
  }
}
