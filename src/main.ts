import * as THREE from 'three'
import { renderer } from './scene/renderer'
import { camera } from './scene/camera'
import { controls } from './scene/controls'
// Auto-select splat implementation (WebGPU vs WebGL)
import { Button3D } from './ui3d/Button3D'
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
type SceneData = {
  filename: string
  buffer: ArrayBuffer
  vertexCount: number
  mapBuffer: ArrayBuffer | null
}

async function fetchSceneData(filename: string): Promise<SceneData> {
  const res = await fetch(`http://localhost:8000/ply?filename=${encodeURIComponent(filename)}`)
  if (!res.ok) throw new Error(`Failed to fetch scene ${filename}`)

  const rawByte = await res.arrayBuffer()
  const srcFloats = new Float32Array(rawByte)
  const vertexCount = Math.floor(srcFloats.length / CONFIG.PACKED_FLOAT_PER_SPLAT)

  const headerVertex = Number(res.headers.get('n-vertex'))
  const headerChannels = Number(res.headers.get('n-channels'))
  if (!Number.isNaN(headerVertex) && vertexCount !== headerVertex) {
    throw new Error(`Point cloud vertex mismatch for ${filename}`)
  }
  if (!Number.isNaN(headerChannels) && CONFIG.PACKED_FLOAT_PER_SPLAT !== headerChannels) {
    throw new Error(`Point cloud channel mismatch for ${filename}`)
  }

  let mapBuffer: ArrayBuffer | null = null
  try {
    const mapRes = await fetch(`http://localhost:8000/map?filename=${encodeURIComponent(filename)}`)
    if (mapRes.ok) {
      mapBuffer = await mapRes.arrayBuffer()
    }
  } catch {
    mapBuffer = null
  }

  return {
    filename,
    buffer: srcFloats.buffer,
    vertexCount,
    mapBuffer,
  }
}

const sceneNames = ['classroom', 'coffee']
const sceneDataList: SceneData[] = []
for (const filename of sceneNames) {
  try {
    sceneDataList.push(await fetchSceneData(filename))
  } catch (err) {
    console.warn(`Scene load failed for ${filename}:`, err)
  }
}

if (sceneDataList.length === 0) {
  throw new Error('No Gaussian splat scenes loaded')
}

for (let i = 0; i < sceneDataList.length; i += 1) {
  const data = sceneDataList[i]
  if (typeof (splat_renderer as any).addSplatBuffer === 'function') {
    const splat = (splat_renderer as any).addSplatBuffer(data.buffer, data.vertexCount)
    if (splat?.mesh) {
      splat.mesh.position.x = i * 2.0
    }
  } else if (i === 0) {
    splat_renderer.setBuffer(data.buffer, data.vertexCount)
  }
}

try {
  if (typeof (splat_renderer as any).setEnvironmentMap === 'function') {
    const firstMap = sceneDataList.find((entry) => entry.mapBuffer)?.mapBuffer ?? null
    if (firstMap) {
      ;(splat_renderer as any).setEnvironmentMap(firstMap)
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

const fpsDiv = document.createElement('div')
fpsDiv.style.position = 'absolute'
fpsDiv.style.top = '10px'
fpsDiv.style.left = '10px'
fpsDiv.style.color = 'white'
fpsDiv.style.background = 'rgba(0, 0, 0, 0.5)'
fpsDiv.style.padding = '5px'
fpsDiv.style.fontFamily = 'monospace'
fpsDiv.style.pointerEvents = 'none'
fpsDiv.innerText = "Press 'B' to toggle Benchmark Mode"
document.body.appendChild(fpsDiv)

let isBenchmarking = false
let benchmarkStartTime = 0
let frameCount = 0

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
      fpsDiv.innerText = "Press 'B' to toggle Benchmark Mode"
    }
  }
})

function animate() {
  requestAnimationFrame(animate)

  if (isBenchmarking) {
    frameCount++
    const elapsed = (performance.now() - benchmarkStartTime) / 1000
    if (elapsed > 0) {
      const avgFps = (frameCount / elapsed).toFixed(1)
      fpsDiv.innerText = `Benchmark: ON\nTime: ${elapsed.toFixed(1)}s\nAvg FPS: ${avgFps}`
    }
  }

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