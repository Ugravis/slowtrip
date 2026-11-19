import { Canvas } from '@react-three/fiber'
import { Scene } from './scene/Scene'

export function App() {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [6, 4, 8], fov: 60, near: 0.1, far: 1000 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <Scene />
    </Canvas>
  )
}
