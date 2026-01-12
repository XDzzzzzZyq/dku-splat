import * as THREE from 'three'

export class Button3D extends THREE.Mesh {
  constructor(color = 0x3366ff) {
    super(
      new THREE.BoxGeometry(0.3, 0.1, 0.05),
      new THREE.MeshStandardMaterial({ color })
    )
  }
}