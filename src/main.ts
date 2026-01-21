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
/*
| pos : vec3(3 * 4) | opacity : float(4) | scl : vec3(3 * 4) | rot : vec3(3 * 4) | color : rgba(4) |
*/
// TODO: Float Buffer <-> Texture Buffer abstraction
const demoVertexCount = 10
{
  const rowFloats = 11; // float bytes = 32 / 4
  const rowBytes = rowFloats * 4;
  const buf = new ArrayBuffer(demoVertexCount * rowBytes)
  const f = new Float32Array(buf)
  const u8 = new Uint8Array(buf)
  for (let i = 0; i < demoVertexCount; i++) {
    // float view: f_buffer[8*i + 0..2] = position
    f[rowFloats * i + 0] = (Math.random() - 0.5) * 3 // x
    f[rowFloats * i + 1] = (Math.random() - 0.2) * 3 // y
    f[rowFloats * i + 2] = (Math.random() - 0.5) * 3 // z
    // ?
    f[rowFloats * i + 3] = 1.0

    // scale
    f[rowFloats * i + 4] = 1
    f[rowFloats * i + 5] = 1
    f[rowFloats * i + 6] = 1
    // rot
    f[rowFloats * i + 7] = Math.random() * 360
    f[rowFloats * i + 8] = Math.random() * 360
    f[rowFloats * i + 9] = Math.random() * 360

    // colors placed at byte offset 48..51 per-row
    const base = i * rowBytes + 10 * 4
    u8[base + 0] = Math.floor(200 + Math.random() * 55)
    u8[base + 1] = Math.floor(100 + Math.random() * 155)
    u8[base + 2] = Math.floor(50 + Math.random() * 205)
    u8[base + 3] = Math.floor(200 + Math.random() * 55)
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