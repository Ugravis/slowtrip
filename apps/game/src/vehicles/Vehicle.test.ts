import { beforeAll, describe, expect, it } from 'vitest'
import { loadRapier, Physics, type Rapier } from '../physics/physics'
import { Vehicle, type DriveControls } from './Vehicle'
import { VEHICLE_SPECS } from './vehicleSpecs'

let rapier: Rapier

beforeAll(async () => {
  rapier = await loadRapier()
})

function setup(id: 'van' | 'offroad') {
  const physics = new Physics(rapier)
  const ground = physics.world.createRigidBody(rapier.RigidBodyDesc.fixed())
  physics.world.createCollider(
    rapier.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0),
    ground,
  )
  const vehicle = new Vehicle(physics, VEHICLE_SPECS[id], 0, 2, 0, 0)
  const run = (seconds: number, controls: DriveControls | null) =>
    physics.update(seconds, (dt) => vehicle.step(dt, controls), Infinity)
  return { physics, vehicle, run }
}

describe.each(['van', 'offroad'] as const)('%s', (id) => {
  it('rests on its suspension when parked', () => {
    const { vehicle, run } = setup(id)
    run(3, null)
    const t = vehicle.body.translation()
    expect(t.y).toBeGreaterThan(vehicle.spec.halfExtents[1])
    expect(t.y).toBeLessThan(3)
    expect(Math.abs(t.x) + Math.abs(t.z)).toBeLessThan(0.2)
  })

  it('drives forward (-Z) and respects top speed', () => {
    const { vehicle, run } = setup(id)
    run(5, null) // long enough for the body to fall asleep
    run(20, { throttle: 1, steer: 0, handbrake: false })
    expect(vehicle.body.translation().z).toBeLessThan(-50)
    expect(vehicle.speed).toBeGreaterThan(vehicle.spec.maxSpeed * 0.8)
    expect(vehicle.speed).toBeLessThan(vehicle.spec.maxSpeed * 1.1)
  })

  it('turns right with positive steer and stays upright', () => {
    const { vehicle, run } = setup(id)
    run(1, null)
    run(3, { throttle: 1, steer: 0, handbrake: false })
    run(3, { throttle: 0.5, steer: 1, handbrake: false })
    expect(vehicle.body.translation().x).toBeGreaterThan(2)
    const q = vehicle.body.rotation()
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z)
    expect(upY).toBeGreaterThan(0.9)
  })

  it('brakes to a stop then reverses', () => {
    const { vehicle, run } = setup(id)
    run(1, null)
    run(5, { throttle: 1, steer: 0, handbrake: false })
    run(6, { throttle: -1, steer: 0, handbrake: false })
    expect(vehicle.speed).toBeLessThan(0)
  })
})
