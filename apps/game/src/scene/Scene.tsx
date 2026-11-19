import { useFrame, useThree } from '@react-three/fiber'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type * as THREE from 'three'
import type { QualitySettings } from '../core/quality'
import { parseSeed } from '../core/rng'
import { RELOAD_SEED_KEY, useSettings } from '../core/settings'
import { Game } from '../game/Game'
import { useGameStore } from '../game/store'
import { loadRapier } from '../physics/physics'
import { CHUNK_SIZE } from '../world/constants'

const SKY = '#a8c8e0'
/** Distance of the directional light from the (floating) origin, along the sun direction. */
const LIGHT_DISTANCE = 100

// Dev-only perf overlay (draw calls, triangles, CPU/GPU time), loaded on demand.
const Perf = lazy(() => import('r3f-perf').then((m) => ({ default: m.Perf })))

/**
 * New world on every load, unless `?seed=` pins one (debug, sharing) or a settings reload
 * carries it over. Choosing the seed is not generation: generation stays deterministic from it.
 * Module scope: evaluated once, so StrictMode's double effects reuse the same seed.
 */
const INITIAL_SEED = (() => {
  const carried = sessionStorage.getItem(RELOAD_SEED_KEY)
  sessionStorage.removeItem(RELOAD_SEED_KEY)
  const fallback = Math.floor(Math.random() * 2 ** 32)
  const param = new URLSearchParams(window.location.search).get('seed')
  return parseSeed(param ?? carried, fallback)
})()

export function Scene({ quality }: { quality: QualitySettings }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const canvas = gl.domElement
  const showPerf = useSettings((s) => s.showPerf)
  const sun = useRef<THREE.DirectionalLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const background = useRef<THREE.Color>(null)
  const fog = useRef<THREE.Fog>(null)
  const [game, setGame] = useState<Game | null>(null)
  const publish = useGameStore((s) => s.setGame)

  useEffect(() => {
    let alive = true
    let created: Game | null = null
    const seed = INITIAL_SEED
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

  useFrame((_, dt) => {
    if (!game) return
    // gl.info still holds the previous frame here (it resets at the start of each render).
    game.recordRender(gl.info.render.calls, gl.info.render.triangles)
    game.update(Math.min(dt, 0.1))

    const sky = game.sky
    if (sun.current) {
      sun.current.position.copy(sky.lightDir).multiplyScalar(LIGHT_DISTANCE)
      sun.current.color.copy(sky.lightColor)
      sun.current.intensity = sky.lightIntensity
    }
    if (hemi.current) {
      hemi.current.color.copy(sky.hemiSky)
      hemi.current.groundColor.copy(sky.hemiGround)
      hemi.current.intensity = sky.hemiIntensity
    }
    background.current?.copy(sky.sky)
    fog.current?.color.copy(sky.sky)
  })

  const fogFar = quality.viewRadius * CHUNK_SIZE
  return (
    <>
      <color ref={background} attach="background" args={[SKY]} />
      <fog ref={fog} attach="fog" args={[SKY, fogFar * 0.45, fogFar * 0.95]} />
      <hemisphereLight ref={hemi} args={['#dfefff', '#5a6b3a', 0.9]} />
      <directionalLight ref={sun} position={[60, 100, 30]} intensity={1.4} />
      {showPerf && (
        <Suspense fallback={null}>
          <Perf position="top-right" minimal={quality.tier === 'low'} />
        </Suspense>
      )}
      {game && <primitive object={game.terrain.group} />}
      {game && <primitive object={game.water.mesh} />}
      {game && <primitive object={game.vehicles.group} />}
    </>
  )
}
