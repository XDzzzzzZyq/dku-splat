import * as THREE from 'three'
import vert from './shaders/splat.vert?raw'
import frag from './shaders/splat.frag?raw'
// pure forward splat (deferred is handled separately)
import { CONFIG } from "../../config.js";

export class GaussianSplatWebGL {
  mesh: THREE.Mesh
  forwardMaterial: THREE.RawShaderMaterial
  worker: Worker | null = null
  data_texture: THREE.DataTexture | null = null
  idx_buffer: THREE.DataTexture | null = null
  vertexCount = 0

  // For lazy update
  _lastView = new Float32Array(16);
  _lastProjection = new Float32Array(16);

  constructor(count = 0) {
    const quad = new Float32Array([
      -1, -1, 0,
       1, -1, 0,
       1,  1, 0,
      -1,  1, 0,
    ])

    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(quad, 3))
    geometry.setIndex([0, 1, 2, 2, 3, 0])
    geometry.instanceCount = 0

    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.BackSide,
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        idx_buffer: { value: null},
        u_data: { value: null },
        projection: { value: new THREE.Matrix4() },
        view: { value: new THREE.Matrix4() },
        focal: { value: new THREE.Vector3(1, 1, 1) },
      }
    })

    this.forwardMaterial = material

    this.mesh = new THREE.Mesh(geometry, material)

    ;(this.mesh as any).onBeforeRender = (renderer: any) => {
      const mat = this.mesh.material as any
      if ((this as any)._shaderChecked) return
      ;(this as any)._shaderChecked = true
      try {
        const gl = renderer.getContext()
        console.log(gl.getParameter(gl.VERSION))
        console.log(gl.getParameter(gl.SHADING_LANGUAGE_VERSION))
        const err = gl.getError();
        if (err !== gl.NO_ERROR) {
          console.error('WebGL error:', err);
        } else{
          console.log('GL no error')
        }
      } catch (err) {
        console.warn('Shader compile check failed', err)
      }
    }

    try {
      this.worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' })
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
    const floatArray = texdata instanceof ArrayBuffer ? new Float32Array(texdata) : new Float32Array((texdata as any).buffer || texdata)
    const tex = new THREE.DataTexture(floatArray, texwidth, texheight, THREE.RGBAFormat, THREE.FloatType)
    tex.needsUpdate = true
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.generateMipmaps = false
    this.data_texture = tex
    this.forwardMaterial.uniforms.u_data.value = tex
  }

  handleDepthIndex(depthIndex: Uint32Array, vertexCount: number) {
    const geom = this.mesh.geometry as THREE.InstancedBufferGeometry
    geom.instanceCount = vertexCount
    this.vertexCount = vertexCount
    if (vertexCount === 0) {
      this.idx_buffer = null
      this.forwardMaterial.uniforms.idx_buffer.value = null
      return
    }
    const texture = new THREE.DataTexture(
      depthIndex,
      CONFIG.DATA_TEXTURE_WIDTH,
      Math.ceil(vertexCount / CONFIG.DATA_TEXTURE_WIDTH),
      THREE.RedIntegerFormat,
      THREE.UnsignedIntType
    )
    texture.needsUpdate = true
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.generateMipmaps = false
    this.forwardMaterial.uniforms.idx_buffer.value = texture
    this.idx_buffer = texture
  }

  setBuffer(buffer: ArrayBuffer, vertexCount: number) {
    if (!this.worker) return
    this.worker.postMessage({ buffer, vertexCount }, [buffer])
  }

  updateUniforms(viewMatrix: Float32Array, projectionMatrix: Float32Array, fx: number, fy: number, fz: number) {
    this.forwardMaterial.uniforms.view.value.fromArray(viewMatrix)
    this.forwardMaterial.uniforms.projection.value.fromArray(projectionMatrix)
    this.forwardMaterial.uniforms.focal.value.set(fx, fy, fz)
    // forward-only: update forward material uniforms
    if (!this.worker) return
    if (this._lastProjection.every((v, i) => Math.abs(v - projectionMatrix[i]) < 1e-2) &&
        this._lastView.every((v, i) => Math.abs(v - viewMatrix[i]) < 1e-2)) {
      return
    }
    this._lastView.set(viewMatrix)
    this._lastProjection.set(projectionMatrix)
    this.worker.postMessage({ view: viewMatrix, projection: projectionMatrix })
  }

  createGBufferMaterial(): THREE.RawShaderMaterial {
    const mat = this.forwardMaterial.clone() as THREE.RawShaderMaterial
    mat.defines = { ...(mat.defines ?? {}), DEFERRED_GBUFFER: 1 }
    mat.transparent = true
    mat.depthWrite = false
    mat.blending = THREE.NormalBlending
    if (this.data_texture) mat.uniforms.u_data.value = this.data_texture
    if (this.idx_buffer) mat.uniforms.idx_buffer.value = this.idx_buffer
    return mat
  }

  // Deferred / render pipeline is managed by GaussianRendererWebGL

  toggleVisible() {
    this.mesh.visible = !this.mesh.visible
  }

  renderOverlay() {
    // no-op for WebGL
  }
}
