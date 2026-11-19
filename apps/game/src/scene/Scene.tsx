import { OrbitControls } from '@react-three/drei'

/** Placeholder scene: proves the render pipeline works. Replaced by terrain (#4). */
export function Scene() {
  return (
    <>
      <color attach="background" args={['#a8c8e0']} />
      <hemisphereLight args={['#dfefff', '#5a6b3a', 0.8]} />
      <directionalLight position={[10, 15, 5]} intensity={1.2} />

      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[50, 50]} />
        <meshStandardMaterial color="#7a9a4a" flatShading />
      </mesh>

      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#d9a441" flatShading />
      </mesh>

      <OrbitControls makeDefault />
    </>
  )
}
