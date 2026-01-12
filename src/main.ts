import * as THREE from 'three'
import { renderer } from './scene/renderer'
import { camera } from './scene/camera'
import { controls } from './scene/controls'
import { GaussianSplat } from './splat/GaussianSplat'
import { Button3D } from './ui3d/Button3D'

console.log("Renderer Capability:", renderer.capabilities.isWebGL2); // true for WebGL2
console.log("Max Vertex Texture:", renderer.capabilities.maxVertexTextures); // for large instance textures

const scene = new THREE.Scene()

scene.add(new THREE.AmbientLight(0xffffff, 0.6))

const splat = new GaussianSplat()
scene.add(splat.mesh)

// Create a small demo buffer (splat-style rows: 32 bytes per vertex)
const demoVertexCount = 2
{
  const rowBytes = 32
  const buf = new ArrayBuffer(demoVertexCount * rowBytes)
  const f = new Float32Array(buf)
  const u8 = new Uint8Array(buf)
  for (let i = 0; i < demoVertexCount; i++) {
    // float view: f_buffer[8*i + 0..2] = position
    f[8 * i + 0] = (Math.random() - 0.5) * 6 // x
    f[8 * i + 1] = (Math.random() - 0.2) * 3 // y
    f[8 * i + 2] = (Math.random() - 0.5) * 6 // z
    // scales
    f[8 * i + 3] = 0.2 + Math.random() * 0.5
    f[8 * i + 4] = 0.2 + Math.random() * 0.5
    f[8 * i + 5] = 0.2 + Math.random() * 0.5
    // covariance placeholders
    f[8 * i + 6] = 0.01
    f[8 * i + 7] = 0.0

    // colors placed at byte offset 24..27 per-row
    const base = i * rowBytes + 28
    u8[base + 0] = Math.floor(200 + Math.random() * 55)
    u8[base + 1] = Math.floor(100 + Math.random() * 155)
    u8[base + 2] = Math.floor(50 + Math.random() * 205)
    u8[base + 3] = 255
  }
  splat.setBuffer(buf, demoVertexCount)
}

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
    splat.updateUniforms(camera.matrixWorldInverse.elements as unknown as Float32Array, camera.projectionMatrix.elements as unknown as Float32Array, 1.0, 1.0)
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