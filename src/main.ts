import * as THREE from 'three'
import { renderer } from './scene/renderer'
import { camera } from './scene/camera'
import { controls } from './scene/controls'
// Auto-select splat implementation (WebGPU vs WebGL)
import { Button3D } from './ui3d/Button3D'
import { InfoPanel3D } from './ui3d/InfoPanel3D'
import { CONFIG } from './config'

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

const interactionObjects: THREE.Object3D[] = []
const registerInteractive = (...objects: THREE.Object3D[]) => {
  interactionObjects.push(...objects)
}

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

if (CONFIG.USE_TRUNK_BASED_RENDERING) {
  if (typeof (splat_renderer as any).initChunkStreaming === 'function') {
    await (splat_renderer as any).initChunkStreaming(CONFIG.SCENE)
  } else {
    throw new Error('Trunk streaming is not supported by the active renderer')
  }
} else {
  const sceneRes = await fetch(`http://localhost:8000/ply?filename=${encodeURIComponent(CONFIG.SCENE)}`)
  if (!sceneRes.ok) throw new Error(`Failed to fetch scene ${CONFIG.SCENE}`)

  const rawByte = await sceneRes.arrayBuffer()
  const srcFloats = new Float32Array(rawByte)
  const vertexCount = Math.floor(srcFloats.length / CONFIG.PACKED_FLOAT_PER_SPLAT)
  splat_renderer.setBuffer(srcFloats.buffer, vertexCount)
}

try {
  if (typeof (splat_renderer as any).setEnvironmentMap === 'function') {
    const mapRes = await fetch(`http://localhost:8000/map?filename=${encodeURIComponent(CONFIG.SCENE)}`)
    if (mapRes.ok) {
      const mapBuffer = await mapRes.arrayBuffer()
      ;(splat_renderer as any).setEnvironmentMap(mapBuffer)
    }
  }
} catch (err) {
  console.warn('Environment map setup failed:', err)
}

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

const infoPanel = new InfoPanel3D({
  title: 'Scene Controls',
  description: `Blue button toggles splat visibility.
Lower button switches deferred mode.
Use the red close button to hide this panel.`,
  billboard: true,
})
infoPanel.position.set(0.2, 0.6, -0.8)
scene.add(infoPanel)

registerInteractive(vis_button, mod_button, ...infoPanel.interactables)

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

window.addEventListener('pointerdown', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(mouse, camera)
  const hits = raycaster.intersectObjects(interactionObjects, true)
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

const fpsDiv = document.createElement('div')
fpsDiv.style.position = 'absolute'
fpsDiv.style.top = '10px'
fpsDiv.style.left = '10px'
fpsDiv.style.color = 'white'
fpsDiv.style.background = 'rgba(0, 0, 0, 0.5)'
fpsDiv.style.padding = '5px'
fpsDiv.style.fontFamily = 'monospace'
fpsDiv.style.pointerEvents = 'none'
fpsDiv.innerText = "Press 'B' to toggle Benchmark Mode\nPress 'A' for fixed pose\nPress 'C' to log pose"
document.body.appendChild(fpsDiv)

let isBenchmarking = false
let benchmarkStartTime = 0
let frameCount = 0
// const fixedPosePosition = new THREE.Vector3(-0.1415, -2.5058, -1.5576)
// const fixedPoseTarget = new THREE.Vector3(-0.1921, -0.2912, -0.2503)
const fixedPosePosition = new THREE.Vector3(2.4396, 0.2282, 1.0201)
const fixedPoseTarget = new THREE.Vector3(0.4078, -0.1714, -0.5057)

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyB') {
    isBenchmarking = !isBenchmarking
    if (isBenchmarking) {
      console.log('Benchmark started')
      controls.autoRotate = true
      controls.autoRotateSpeed = 2.0
      benchmarkStartTime = performance.now()
      frameCount = 0
    } else {
      console.log('Benchmark stopped')
      controls.autoRotate = false
      frameCount = 0
      fpsDiv.innerText = "Press 'B' to toggle Benchmark Mode\nPress 'A' for fixed pose\nPress 'C' to log pose"
    }
  } else if (e.code === 'KeyA') {
    isBenchmarking = false
    controls.autoRotate = false
    frameCount = 0

    camera.position.copy(fixedPosePosition)
    controls.target.copy(fixedPoseTarget)
    camera.lookAt(fixedPoseTarget)
    controls.update()

    fpsDiv.innerText = "Fixed pose applied\nPress 'B' to toggle Benchmark Mode\nPress 'A' for fixed pose\nPress 'C' to log pose"
  } else if (e.code === 'KeyC') {
    const pos = camera.position
    const tar = controls.target
    console.log(`Camera position: (${pos.x.toFixed(4)}, ${pos.y.toFixed(4)}, ${pos.z.toFixed(4)})`)
    console.log(`Camera target:   (${tar.x.toFixed(4)}, ${tar.y.toFixed(4)}, ${tar.z.toFixed(4)})`)
  }
})

function animate() {
  requestAnimationFrame(animate)

  if (CONFIG.USE_TRUNK_BASED_RENDERING && typeof (splat_renderer as any).updateChunkStreaming === 'function') {
    ;(splat_renderer as any).updateChunkStreaming(camera)
  }

  if (isBenchmarking) {
    frameCount++
    const elapsed = (performance.now() - benchmarkStartTime) / 1000
    if (elapsed > 0) {
      const avgFps = (frameCount / elapsed).toFixed(1)
      fpsDiv.innerText = `Benchmark: ON\nTime: ${elapsed.toFixed(1)}s\nAvg FPS: ${avgFps}`
    }
  }

  infoPanel.update(camera)
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