import * as THREE from 'three'
import vert from './shaders/splat.vert?raw'
import frag from './shaders/splat.frag?raw'
import deferredVert from './shaders/deferred.vert?raw'
import deferredFrag from './shaders/deferred.frag?raw'
import { CONFIG } from "../../config.js";

export class GaussianSplatWebGL {
  mesh: THREE.Mesh
  forwardMaterial: THREE.RawShaderMaterial
  gbufferMaterial: THREE.RawShaderMaterial | null = null
  gbufferTarget: THREE.WebGLMultipleRenderTargets | null = null
  resolveScene: THREE.Scene | null = null
  resolveCamera: THREE.OrthographicCamera | null = null
  resolveMesh: THREE.Mesh | null = null
  deferredMode = 3
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
    if (this.gbufferMaterial) this.gbufferMaterial.uniforms.u_data.value = tex
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
    if (this.gbufferMaterial) this.gbufferMaterial.uniforms.idx_buffer.value = texture

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
    if (this.gbufferMaterial) {
      this.gbufferMaterial.uniforms.view.value.fromArray(viewMatrix)
      this.gbufferMaterial.uniforms.projection.value.fromArray(projectionMatrix)
      this.gbufferMaterial.uniforms.focal.value.set(fx, fy, fz)
    }
    if (!this.worker) return
    this.worker.postMessage({ view: viewMatrix })
  }

  initDeferred(renderer: THREE.WebGLRenderer) {
    if (!(renderer.capabilities as any).isWebGL2) {
      console.warn('Deferred G-buffer requires WebGL2 (MRT). Falling back to forward splat.')
      return
    }

    if (!this.gbufferMaterial) {
      const mat = this.forwardMaterial.clone() as THREE.RawShaderMaterial
      mat.defines = { ...(mat.defines ?? {}), DEFERRED_GBUFFER: 1 }
      // We accumulate (value, w) into the G-buffer with normal blending.
      mat.transparent = true
      mat.depthWrite = false
      mat.blending = THREE.NormalBlending
      this.gbufferMaterial = mat

      // Keep data/idx buffers in sync if they were already created
      if (this.data_texture) mat.uniforms.u_data.value = this.data_texture
      if (this.idx_buffer) mat.uniforms.idx_buffer.value = this.idx_buffer
    }

    const size = new THREE.Vector2()
    renderer.getDrawingBufferSize(size)
    this.resizeDeferred(renderer, size.x, size.y)

    if (!this.resolveScene) {
      const quad = new Float32Array([
        -1, -1, 0,
         1, -1, 0,
         1,  1, 0,
        -1,  1, 0,
      ])
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(quad, 3))
      geometry.setIndex([0, 1, 2, 2, 3, 0])

      const resolveMat = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        depthTest: false,
        depthWrite: false,
        transparent: false,
        vertexShader: deferredVert,
        fragmentShader: deferredFrag,
        uniforms: {
          tColor: { value: null },
          tPos: { value: null },
          tPbr: { value: null },
          uMode: { value: this.deferredMode },
        },
      })

      this.resolveMesh = new THREE.Mesh(geometry, resolveMat)
      this.resolveScene = new THREE.Scene()
      this.resolveScene.add(this.resolveMesh)
      this.resolveCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

      // Wire current MRT textures if already allocated
      if (this.gbufferTarget) {
        resolveMat.uniforms.tColor.value = this.gbufferTarget.texture[0]
        resolveMat.uniforms.tPos.value = this.gbufferTarget.texture[1]
        resolveMat.uniforms.tPbr.value = this.gbufferTarget.texture[2]
      }
    }
  }

  resizeDeferred(renderer: THREE.WebGLRenderer, width?: number, height?: number) {
    if (!(renderer.capabilities as any).isWebGL2) return

    const size = new THREE.Vector2(width ?? 0, height ?? 0)
    if (!width || !height) renderer.getDrawingBufferSize(size)

    if (this.gbufferTarget && this.gbufferTarget.width === size.x && this.gbufferTarget.height === size.y) {
      return
    }

    const mrt = new THREE.WebGLMultipleRenderTargets(size.x, size.y, 3)
    mrt.texture[0].name = 'gColor'
    mrt.texture[1].name = 'gPos'
    mrt.texture[2].name = 'gPbr'

    for (const tex of mrt.texture) {
      tex.type = THREE.HalfFloatType
      tex.format = THREE.RGBAFormat
      tex.minFilter = THREE.NearestFilter
      tex.magFilter = THREE.NearestFilter
      tex.generateMipmaps = false
    }

    mrt.depthBuffer = false
    this.gbufferTarget = mrt

    const resolveMat = this.resolveMesh?.material as THREE.RawShaderMaterial | undefined
    if (resolveMat) {
      resolveMat.uniforms.tColor.value = mrt.texture[0]
      resolveMat.uniforms.tPos.value = mrt.texture[1]
      resolveMat.uniforms.tPbr.value = mrt.texture[2]
    }
  }

  setDeferredMode(mode: number) {
    this.deferredMode = mode
    const resolveMat = this.resolveMesh?.material as THREE.RawShaderMaterial | null
    if (resolveMat) resolveMat.uniforms.uMode.value = mode
  }

  renderDeferred(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    if (!this.gbufferTarget || !this.resolveScene || !this.resolveCamera || !this.gbufferMaterial) return

    // Resize to current drawing buffer if needed
    const size = new THREE.Vector2()
    renderer.getDrawingBufferSize(size)
    if (this.gbufferTarget.width !== size.x || this.gbufferTarget.height !== size.y) {
      this.resizeDeferred(renderer, size.x, size.y)
      if (!this.gbufferTarget) return
    }

    const prevTarget = renderer.getRenderTarget()
    const prevClear = new THREE.Color()
    renderer.getClearColor(prevClear)
    const prevClearAlpha = renderer.getClearAlpha()

    // Accum buffers must start at 0.
    renderer.setClearColor(0x000000, 0)

    const prevMaterial = this.mesh.material
    this.mesh.material = this.gbufferMaterial
    renderer.setRenderTarget(this.gbufferTarget)
    renderer.clear(true, false, false)
    renderer.render(scene, camera)
    this.mesh.material = prevMaterial

    renderer.setRenderTarget(null)
    renderer.setClearColor(prevClear, prevClearAlpha)
    renderer.render(this.resolveScene, this.resolveCamera)
    renderer.setRenderTarget(prevTarget)
  }

  toggleVisible() {
    this.mesh.visible = !this.mesh.visible
  }

  renderOverlay() {
    // no-op for WebGL
  }
}
