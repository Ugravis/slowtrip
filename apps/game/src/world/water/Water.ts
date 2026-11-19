import * as THREE from 'three'
import { WATER_LEVEL } from '../constants'
import { WATER_SRGB } from '../terrain/biomes'

/**
 * Lakes: one translucent plane at the water level that follows the player.
 * Terrain above the water line hides it, so a single draw call covers every lake in view.
 */
export class Water {
  readonly mesh: THREE.Mesh

  constructor(size: number) {
    const geometry = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2)
    const material = new THREE.MeshLambertMaterial({
      color: new THREE.Color().setRGB(...WATER_SRGB, THREE.SRGBColorSpace),
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.name = 'water'
    this.mesh.matrixAutoUpdate = false
    // Drawn after the terrain.
    this.mesh.renderOrder = 1
    this.mesh.position.y = WATER_LEVEL
  }

  /** Centers the plane under a local position. */
  follow(localX: number, localZ: number): void {
    this.mesh.position.x = localX
    this.mesh.position.z = localZ
    this.mesh.updateMatrix()
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
