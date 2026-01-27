import * as THREE from 'three'
import vert from './shaders/splat.vert?raw'
import frag from './shaders/splat.frag?raw'

export class GaussianSplatWebGL {
  mesh: THREE.Mesh
  worker: Worker | null = null
  texture: THREE.DataTexture | null = null
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
        idx_buffer: { value:null} ,
        u_texture: { value: null },
        projection: { value: new THREE.Matrix4() },
        view: { value: new THREE.Matrix4() },
        focal: { value: new THREE.Vector3(1, 1, 1) },
      }
    })

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
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
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
    this.texture = tex
    ;(this.mesh.material as THREE.RawShaderMaterial).uniforms.u_texture.value = tex
  }

  handleDepthIndex(depthIndex: Uint32Array, vertexCount: number) {
    const texture = new THREE.DataTexture(
      depthIndex,
      1024,
      Math.ceil(vertexCount / 1024),
      THREE.RedIntegerFormat,
      THREE.UnsignedIntType
    )
    texture.needsUpdate = true
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.generateMipmaps = false
    ;(this.mesh.material as THREE.RawShaderMaterial).uniforms.idx_buffer.value = texture

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
    const material = this.mesh.material as THREE.RawShaderMaterial
    material.uniforms.view.value.fromArray(viewMatrix)
    material.uniforms.projection.value.fromArray(projectionMatrix)
    material.uniforms.focal.value.set(fx, fy, fz)
    if (!this.worker) return
    this.worker.postMessage({ view: viewMatrix })
  }

  toggleVisible() {
    this.mesh.visible = !this.mesh.visible
  }

  renderOverlay() {
    // no-op for WebGL
  }
}
