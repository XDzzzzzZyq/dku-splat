import * as THREE from 'three'
import deferredVert from './shaders/deferred.vert?raw'
import deferredFrag from './shaders/deferred.frag?raw'

export class DeferredWebGL {
  mesh: THREE.Mesh
  forwardMaterial: THREE.RawShaderMaterial
  gbufferMaterial: THREE.RawShaderMaterial | null = null
  gbufferTarget: THREE.WebGLMultipleRenderTargets | null = null
  resolveScene: THREE.Scene | null = null
  resolveCamera: THREE.OrthographicCamera | null = null
  resolveMesh: THREE.Mesh | null = null
  deferredMode = 0
  data_texture: THREE.DataTexture | null = null
  idx_buffer: THREE.DataTexture | null = null

  constructor(mesh: THREE.Mesh, forwardMaterial: THREE.RawShaderMaterial) {
    this.mesh = mesh
    this.forwardMaterial = forwardMaterial
  }

  init(renderer: THREE.WebGLRenderer) {
    if (!(renderer.capabilities as any).isWebGL2) {
      console.warn('Deferred G-buffer requires WebGL2 (MRT). Falling back to forward splat.')
      return
    }

    if (!this.gbufferMaterial) {
      const mat = this.forwardMaterial.clone() as THREE.RawShaderMaterial
      mat.defines = { ...(mat.defines ?? {}), DEFERRED_GBUFFER: 1 }
      mat.transparent = true
      mat.depthWrite = false
      mat.blending = THREE.NormalBlending
      this.gbufferMaterial = mat

      if (this.data_texture) mat.uniforms.u_data.value = this.data_texture
      if (this.idx_buffer) mat.uniforms.idx_buffer.value = this.idx_buffer
    }

    const size = new THREE.Vector2()
    renderer.getDrawingBufferSize(size)
    this.resize(renderer, size.x, size.y)

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

      if (this.gbufferTarget) {
        resolveMat.uniforms.tColor.value = this.gbufferTarget.texture[0]
        resolveMat.uniforms.tPos.value = this.gbufferTarget.texture[1]
        resolveMat.uniforms.tPbr.value = this.gbufferTarget.texture[2]
      }
    }
  }

  resize(renderer: THREE.WebGLRenderer, width?: number, height?: number) {
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

  setDeferredMode() {
    this.deferredMode = (this.deferredMode + 1) % 3
    const resolveMat = this.resolveMesh?.material as THREE.RawShaderMaterial | null
    if (resolveMat) resolveMat.uniforms.uMode.value = this.deferredMode
  }

  setDataTexture(tex: THREE.DataTexture | null) {
    this.data_texture = tex
    if (this.gbufferMaterial) this.gbufferMaterial.uniforms.u_data.value = tex
  }

  setIdxBuffer(tex: THREE.DataTexture | null) {
    this.idx_buffer = tex
    if (this.gbufferMaterial) this.gbufferMaterial.uniforms.idx_buffer.value = tex
  }

  updateUniforms(viewMatrix: Float32Array, projectionMatrix: Float32Array, fx: number, fy: number, fz: number) {
    if (!this.gbufferMaterial) return
    this.gbufferMaterial.uniforms.view.value.fromArray(viewMatrix)
    this.gbufferMaterial.uniforms.projection.value.fromArray(projectionMatrix)
    this.gbufferMaterial.uniforms.focal.value.set(fx, fy, fz)
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    if (!this.gbufferTarget || !this.resolveScene || !this.resolveCamera || !this.gbufferMaterial) return

    const size = new THREE.Vector2()
    renderer.getDrawingBufferSize(size)
    if (this.gbufferTarget.width !== size.x || this.gbufferTarget.height !== size.y) {
      this.resize(renderer, size.x, size.y)
      if (!this.gbufferTarget) return
    }

    const prevTarget = renderer.getRenderTarget()
    const prevClear = new THREE.Color()
    renderer.getClearColor(prevClear)
    const prevClearAlpha = renderer.getClearAlpha()

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
}
