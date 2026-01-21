import * as THREE from 'three'
import { renderer } from './scene/renderer'
import { camera } from './scene/camera'
import { controls } from './scene/controls'
import { GaussianSplat } from './splat/GaussianSplat'
import { Button3D } from './ui3d/Button3D'

import {demoVertexCount, buf} from './scene/test/test_scene_cup'

console.log("Renderer Capability:", renderer.capabilities.isWebGL2); // true for WebGL2
console.log("Max Vertex Texture:", renderer.capabilities.maxVertexTextures); // for large instance textures

const scene = new THREE.Scene()

scene.add(new THREE.AmbientLight(0xffffff, 0.6))

const splat = new GaussianSplat()
scene.add(splat.mesh)

// Create a small demo buffer (splat-style rows: 32 bytes per vertex)
/*
| pos : vec3(3 * 4) | opacity : float(4) | scl : vec3(3 * 4) | rot : vec3(3 * 4) | color : rgba(4) |
*/
// TODO: Float Buffer <-> Texture Buffer abstraction
splat.setBuffer(buf, demoVertexCount)

const button = new Button3D()
button.position.set(0.6, 0.4, -0.5)
button.userData.onClick = () => {
  splat.mesh.visible = !splat.mesh.visible
}
scene.add(button)

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

window.addEventListener('pointerdown', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(mouse, camera)
  const hits = raycaster.intersectObjects(scene.children, true)
  hits[0]?.object.userData.onClick?.()
})

function animate() {
  requestAnimationFrame(animate)
  controls.update()
  // update splat shader uniforms with current camera
  // three.js camera matrices
  try {
    splat.updateUniforms(
      camera.matrixWorldInverse.elements as unknown as Float32Array, 
      camera.projectionMatrix.elements as unknown as Float32Array, 
      camera.aspect, 1.0, 1.0) // TODO: adjustbale focal length
  } catch (err) {
    // ignore if method missing
  }
  renderer.render(scene, camera)
  const gl = renderer.getContext()
  const err = gl.getError();
        if (err !== gl.NO_ERROR) {
          console.error('WebGL error:', err);
        }
}

animate()