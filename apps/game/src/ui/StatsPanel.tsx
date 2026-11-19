import { useEffect, useRef } from 'react'
import { useSettings } from '../core/settings'
import type { Game, PlayerPose } from '../game/Game'
import { CHUNK_SIZE } from '../world/constants'
import { formatTime } from '../world/sky/dayNight'

const POLL_MS = 250

function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`
}

/** Top-left readout. Polls the simulation at 4 Hz and writes text directly (no React renders). */
export function StatsPanel({ game }: { game: Game }) {
  const el = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const pose: PlayerPose = { x: 0, y: 0, z: 0, heading: 0 }
    let lastFrames = game.stats.frames
    let lastTime = performance.now()
    let fps = 0
    const id = window.setInterval(() => {
      const now = performance.now()
      const frames = game.stats.frames
      fps = ((frames - lastFrames) * 1000) / (now - lastTime)
      lastFrames = frames
      lastTime = now
      if (!el.current) return

      game.pose(pose)
      const deg = ((((-pose.heading * 180) / Math.PI) % 360) + 360) % 360
      const lines = [
        game.driven
          ? `${Math.round(game.speedKmh)} km/h · ${game.driven.spec.name}${game.handbrake ? ' · P' : ''}${game.headlights ? ' · lights' : ''}`
          : 'On foot',
        `${Math.round(fps)} fps · ${fps > 0 ? (1000 / fps).toFixed(1) : '-'} ms`,
        // r3f-perf manages gl.info resets itself: read its overlay instead.
        useSettings.getState().showPerf
          ? 'calls · tris: see perf overlay'
          : `${game.stats.drawCalls} calls · ${formatCount(game.stats.triangles)} tris`,
        `${formatTime(game.dayNight.time)} · ${game.quality.tier} quality`,
        `x ${Math.round(pose.x)} z ${Math.round(pose.z)} · alt ${Math.round(pose.y)} m`,
        `biome ${game.biomeAt(pose.x, pose.z)}`,
        `chunk ${Math.floor(pose.x / CHUNK_SIZE)},${Math.floor(pose.z / CHUNK_SIZE)} · ${game.terrain.loadedChunks} loaded · ${Math.round(deg)}°`,
        `seed ${game.seed}`,
      ]
      el.current.textContent = lines.join('\n')
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [game])

  return <pre ref={el} className="hud-stats" />
}
