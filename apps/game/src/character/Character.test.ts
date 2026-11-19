import { beforeAll, describe, expect, it } from 'vitest'
import { loadRapier, Physics, type Rapier } from '../physics/physics'
import { Character, type WalkControls } from './Character'

let rapier: Rapier

beforeAll(async () => {
  rapier = await loadRapier()
})

function setup() {
  const physics = new Physics(rapier)
  const ground = physics.world.createRigidBody(rapier.RigidBodyDesc.fixed())
  physics.world.createCollider(
    rapier.ColliderDesc.cuboid(100, 0.5, 100).setTranslation(0, -0.5, 0),
    ground,
  )
  const character = new Character(physics, 0, 0.5, 0)
  const run = (seconds: number, controls: WalkControls) =>
    physics.update(seconds, (dt) => character.step(dt, controls), Infinity)
  return { character, run }
}

const idle: WalkControls = { x: 0, y: 0, sprint: false, jump: false }

describe('Character', () => {
  it('falls onto the ground and stays grounded', () => {
    const { character, run } = setup()
    run(1, idle)
    expect(character.grounded).toBe(true)
    expect(character.body.translation().y).toBeCloseTo(0.9, 1)
  })

  it('walks forward toward -Z at yaw 0, and along -X at yaw +90°', () => {
    const { character, run } = setup()
    run(0.5, idle)
    run(2, { ...idle, y: 1 })
    const t = character.body.translation()
    expect(t.z).toBeLessThan(-5)
    expect(Math.abs(t.x)).toBeLessThan(0.1)

    character.yaw = Math.PI / 2
    run(2, { ...idle, y: 1 })
    expect(character.body.translation().x).toBeLessThan(-5)
  })

  it('sprints faster than it walks', () => {
    const a = setup()
    const b = setup()
    a.run(0.5, idle)
    b.run(0.5, idle)
    a.run(2, { ...idle, y: 1 })
    b.run(2, { ...idle, y: 1, sprint: true })
    expect(b.character.body.translation().z).toBeLessThan(a.character.body.translation().z - 3)
  })

  it('jumps and lands', () => {
    const { character, run } = setup()
    run(0.5, idle)
    run(1 / 60, { ...idle, jump: true })
    run(0.2, idle)
    expect(character.body.translation().y).toBeGreaterThan(1.3)
    run(1.5, idle)
    expect(character.grounded).toBe(true)
  })
})
