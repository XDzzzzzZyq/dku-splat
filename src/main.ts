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

// Separate scene for splat G-buffer pass (deferred pipeline)
const splatScene = new THREE.Scene()

scene.add(new THREE.AmbientLight(0xffffff, 0.6))

let splat_renderer: any
if (render_capabilities === 'WebGPU') {
  const mod = await import('./splat/webgpu/GaussianSplatWebGPU')
  splat_renderer = new mod.GaussianSplatWebGPU()
} else {
  const mod = await import('./splat/webgl/GaussianRendererWebGL')
  splat_renderer = new mod.GaussianRendererWebGL()
}
// Put splats in their own scene (so we can render them into the G-buffer)
splatScene.add(splat_renderer.mesh)

// Initialize deferred pipeline for WebGL renderer
try {
  if ((renderer as any).isWebGLRenderer && typeof (splat_renderer as any).initDeferred === 'function') {
    ;(splat_renderer as any).initDeferred(renderer)
  }
} catch (err) {
  console.warn('Deferred init failed:', err)
}

// Create a small demo buffer (splat-style rows: 32 bytes per vertex)
/*
| pos : vec3(3 * 4) | opacity : float(4) | scl : vec3(3 * 4) | rot : vec3(3 * 4) | color : rgba(4) |
*/
// TODO: Float Buffer <-> Texture Buffer abstraction
splat_renderer.setBuffer(buf, demoVertexCount)

const vis_button = new Button3D()
vis_button.position.set(1.0, 0.4, -0.5)
vis_button.userData.onClick = () => {
  splat_renderer.toggleVisible()
}
scene.add(vis_button)

const mod_button = new Button3D()
mod_button.position.set(1.0, 0.2, -0.5)
mod_button.userData.onClick = () => {
  splat_renderer.setDeferredMode()
}
scene.add(mod_button)

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

    try {
      ;(splat_renderer as any).resizeDeferred?.(renderer)
    } catch {
      // ignore
    }
});

function animate() {
  requestAnimationFrame(animate)
  controls.update()
  // update splat shader uniforms with current camera
  // three.js camera matrices
  try {
    splat_renderer.updateUniforms(
      camera.matrixWorldInverse.elements as unknown as Float32Array, 
      camera.projectionMatrix.elements as unknown as Float32Array, 
      camera.aspect, 1.0, 1.0) // TODO: adjustbale focal length
  } catch (err) {
    // ignore if method missing
  }
  // Deferred splat render (G-buffer -> resolve) when available
  if ((renderer as any).isWebGLRenderer && typeof (splat_renderer as any).renderDeferred === 'function') {
    ;(splat_renderer as any).renderDeferred(renderer, splatScene, camera)
    // Render the rest of the scene on top (no clear)
    const prevAutoClear = (renderer as any).autoClear
    ;(renderer as any).autoClear = false
    renderer.render(scene, camera)
    ;(renderer as any).autoClear = prevAutoClear
  } else {
    renderer.render(scene, camera)
  }
  splat_renderer.renderOverlay?.()
  const gl = renderer.getContext?.()
  if (gl && 'getError' in gl) {
    const err = (gl as WebGL2RenderingContext).getError();
    if (err !== (gl as WebGL2RenderingContext).NO_ERROR) {
      console.error('WebGL error:', err);
    }
  }
}

animate()