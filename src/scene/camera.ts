import * as THREE from 'three'

export const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.01,
  100
)

camera.position.set(0, 0, 3)