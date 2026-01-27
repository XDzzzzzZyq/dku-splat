import * as THREE from 'three'
import { renderer } from './scene/renderer'
import { camera } from './scene/camera'
import { controls } from './scene/controls'
// Auto-select splat implementation (WebGPU vs WebGL)
import { Button3D } from './ui3d/Button3D'

import {demoVertexCount, buf} from './scene/test/test_scene_cup'

// Log renderer capabilities where available (WebGPU renderer may not expose same fields)
const render_capabilities =
((renderer as any).capabilities?.isWebGL2 ?? false)
  ? "Web GL2"
  : "WebGPU";
console.log("Renderer Capability:", render_capabilities)
console.log("Max Vertex Texture:", (renderer as any).capabilities?.maxVertexTextures ?? 'n/a')

const scene = new THREE.Scene()

scene.add(new THREE.AmbientLight(0xffffff, 0.6))

let splat: any
if (render_capabilities === 'WebGPU') {
  const mod = await import('./splat/webgpu/GaussianSplatWebGPU')
  splat = new mod.GaussianSplatWebGPU()
} else {
  const mod = await import('./splat/webgl/GaussianSplatWebGL')
  splat = new mod.GaussianSplatWebGL()
}
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
  splat.toggleVisible()
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

window.addEventListener('resize', () => {
    const width = window.innerWidth
    const height = window.innerHeight

    camera.aspect = width / height
    camera.updateProjectionMatrix()

    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
});

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
  splat.renderOverlay?.()
  const gl = renderer.getContext?.()
  if (gl && 'getError' in gl) {
    const err = (gl as WebGL2RenderingContext).getError();
    if (err !== (gl as WebGL2RenderingContext).NO_ERROR) {
      console.error('WebGL error:', err);
    }
  }
}

animate()