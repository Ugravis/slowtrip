import { Canvas } from '@react-three/fiber'
import { useState } from 'react'
import { detectQuality } from './core/quality'
import { Scene } from './scene/Scene'

export function App() {
  const [quality] = useState(detectQuality)
  return (
    <Canvas
      dpr={quality.dpr}
      camera={{ position: [0, 40, 0], fov: 65, near: 0.1, far: 2000 }}
      gl={{ antialias: quality.antialias, powerPreference: 'high-performance' }}
    >
      <Scene quality={quality} />
    </Canvas>
  )
}
