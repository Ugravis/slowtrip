import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import type * as THREE from 'three'
import type { QualitySettings } from '../core/quality'
import { parseSeed } from '../core/rng'
import { Game } from '../game/Game'
import { useGameStore } from '../game/store'
import { loadRapier } from '../physics/physics'
import { CHUNK_SIZE, DEFAULT_SEED } from '../world/constants'

const SKY = '#a8c8e0'

export function Scene({ quality }: { quality: QualitySettings }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const canvas = useThree((s) => s.gl.domElement)
  const [game, setGame] = useState<Game | null>(null)
  const publish = useGameStore((s) => s.setGame)

  useEffect(() => {
    let alive = true
    let created: Game | null = null
    const seed = parseSeed(new URLSearchParams(window.location.search).get('seed'), DEFAULT_SEED)
    void loadRapier().then((rapier) => {
      if (!alive) return
      created = new Game(rapier, seed, quality, camera)
      setGame(created)
      publish(created)
      if (import.meta.env.DEV) Object.assign(window, { slowtrip: created })
    })
    return () => {
      alive = false
      publish(null)
      created?.dispose()
    }
  }, [camera, quality, publish])

  useEffect(() => game?.input.attachPointerLock(canvas), [game, canvas])

  useFrame((_, dt) => game?.update(Math.min(dt, 0.1)))

  const fogFar = quality.viewRadius * CHUNK_SIZE
  return (
    <>
      <color attach="background" args={[SKY]} />
      <fog attach="fog" args={[SKY, fogFar * 0.45, fogFar * 0.95]} />
      <hemisphereLight args={['#dfefff', '#5a6b3a', 0.9]} />
      <directionalLight position={[60, 100, 30]} intensity={1.4} />
      {game && <primitive object={game.terrain.group} />}
      {game && <primitive object={game.vehicles.group} />}
    </>
  )
}
