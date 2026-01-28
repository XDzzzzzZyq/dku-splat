import * as THREE from 'three'
import vert from './shaders/splat.vert?raw'
import frag from './shaders/splat.frag?raw'
import deferredVert from './shaders/deferred.vert?raw'
import deferredFrag from './shaders/deferred.frag?raw'
import { DeferredWebGL } from './DeferredWebGL'
import { CONFIG } from "../../config.js";

export class GaussianSplatWebGL {
  mesh: THREE.Mesh
  forwardMaterial: THREE.RawShaderMaterial
  deferred: DeferredWebGL | null = null
  worker: Worker | null = null
  data_texture: THREE.DataTexture | null = null
  idx_buffer: THREE.DataTexture | null = null
  vertexCount = 0

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
    if (this.deferred) this.deferred.setDataTexture(tex)
  }

  handleDepthIndex(depthIndex: Uint32Array, vertexCount: number) {
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
    if (this.deferred) this.deferred.setIdxBuffer(texture)

    const geom = this.mesh.geometry as THREE.InstancedBufferGeometry
    geom.instanceCount = vertexCount
    this.vertexCount = vertexCount
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
    if (this.deferred) this.deferred.updateUniforms(viewMatrix, projectionMatrix, fx, fy, fz)
    if (!this.worker) return
    this.worker.postMessage({ view: viewMatrix })
  }

  initDeferred(renderer: THREE.WebGLRenderer) {
    if (!(renderer.capabilities as any).isWebGL2) {
      console.warn('Deferred G-buffer requires WebGL2 (MRT). Falling back to forward splat.')
      return
    }

    if (!this.deferred) {
      this.deferred = new DeferredWebGL(this.mesh, this.forwardMaterial)
      if (this.data_texture) this.deferred.setDataTexture(this.data_texture)
      if (this.idx_buffer) this.deferred.setIdxBuffer(this.idx_buffer)
    }

    this.deferred.init(renderer)
  }

  resizeDeferred(renderer: THREE.WebGLRenderer, width?: number, height?: number) {
    if (this.deferred) this.deferred.resize(renderer, width, height)
  }

  setDeferredMode() {
    if (this.deferred) this.deferred.setDeferredMode()
  }

  renderDeferred(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    if (this.deferred) this.deferred.render(renderer, scene, camera)
  }

  toggleVisible() {
    this.mesh.visible = !this.mesh.visible
  }

  renderOverlay() {
    // no-op for WebGL
  }
}
