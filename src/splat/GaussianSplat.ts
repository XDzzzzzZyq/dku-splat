import * as THREE from 'three'
import vert from './shaders/splat.vert?raw'
import frag from './shaders/splat.frag?raw'

export class GaussianSplat {
  mesh: THREE.Mesh
  worker: Worker | null = null
  texture: THREE.DataTexture | null = null
  vertexCount = 0

  constructor(count = 2000) {
    // Quad positions (3 components per vertex; z=0) — three.js expects vec3 for bounding
    const quad = new Float32Array([
      -2, -2, 0,
       2, -2, 0,
       2,  2, 0,
      -2,  2, 0,
    ])

    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(quad, 3))
    geometry.setIndex([0, 1, 2, 2, 3, 0])
    geometry.instanceCount = 0

    // placeholder index attribute for instancing (will be updated with depthIndex)
    const indexArray = new Uint32Array(count)
    geometry.setAttribute('index', new THREE.InstancedBufferAttribute(indexArray, 1, false))

    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        u_texture: { value: null },
        projection: { value: new THREE.Matrix4() },
        view: { value: new THREE.Matrix4() },
        focal: { value: new THREE.Vector2(1, 1) },
        viewport: { value: new THREE.Vector2(1, 1) }
      }
    })

    this.mesh = new THREE.Mesh(geometry, material)

    // spawn worker
    try {
      this.worker = new Worker(new URL('./worker.js', import.meta.url))
      this.worker.onmessage = (e) => {
        if (e.data.texdata) {
          this.handleTexdata(e.data.texdata, e.data.texwidth, e.data.texheight)
        } else if (e.data.depthIndex) {
          this.handleDepthIndex(e.data.depthIndex, e.data.vertexCount)
        }
      }
    } catch (err) {
      console.warn('Worker creation failed:', err)
      this.worker = null
    }
  }

  handleTexdata(texdata: Uint32Array, texwidth: number, texheight: number) {
    // create a three.js DataTexture using float format. The worker packed some values as uints
    // into the same buffer; those bit patterns are preserved when viewed as Float32Array.
    const floatArray = texdata instanceof ArrayBuffer ? new Float32Array(texdata) : new Float32Array((texdata as any).buffer || texdata)
    const tex = new THREE.DataTexture(floatArray, texwidth, texheight, THREE.RGBAFormat, THREE.FloatType)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.needsUpdate = true
    this.texture = tex
    ;(this.mesh.material as THREE.RawShaderMaterial).uniforms.u_texture.value = tex
  }

  handleDepthIndex(depthIndex: Uint32Array, vertexCount: number) {
    const geom = this.mesh.geometry as THREE.InstancedBufferGeometry
    geom.setAttribute('index', new THREE.InstancedBufferAttribute(depthIndex, 1, false))
    geom.instanceCount = vertexCount
    this.vertexCount = vertexCount
  }

  setBuffer(buffer: ArrayBuffer, vertexCount: number) {
    if (!this.worker) return
    this.worker.postMessage({ buffer, vertexCount }, [buffer])
  }

  updateUniforms(viewMatrix: Float32Array, projectionMatrix: Float32Array, fx: number, fy: number) {
    const material = this.mesh.material as THREE.RawShaderMaterial
    material.uniforms.view.value.fromArray(viewMatrix)
    material.uniforms.projection.value.fromArray(projectionMatrix)
    material.uniforms.focal.value.set(fx, fy)
    material.uniforms.viewport.value.set((this.mesh as any).onBeforeRender ? (this.mesh as any).onBeforeRender.width : 1, (this.mesh as any).onBeforeRender ? (this.mesh as any).onBeforeRender.height : 1)
  }
}
