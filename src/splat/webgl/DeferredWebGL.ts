import * as THREE from 'three'
import deferredVert from './shaders/deferred.vert?raw'
import deferredFrag from './shaders/deferred.frag?raw'

export class DeferredWebGL {
  gbufferMaterial: THREE.RawShaderMaterial | null = null
  gbufferTarget: THREE.WebGLMultipleRenderTargets | null = null
  resolveScene: THREE.Scene | null = null
  resolveCamera: THREE.OrthographicCamera | null = null
  resolveMesh: THREE.Mesh | null = null
  deferredMode = 0
  data_texture: THREE.DataTexture | null = null
  idx_buffer: THREE.DataTexture | null = null

  constructor() {
    // DeferredWebGL does not own or compile splat materials; it only manages
    // the MRT targets and the resolve pass. Materials are provided at render
    // time by GaussianSplatWebGL (the splat implementation).
  }

  init(renderer: THREE.WebGLRenderer) {
    if (!(renderer.capabilities as any).isWebGL2) {
      console.warn('Deferred G-buffer requires WebGL2 (MRT). Falling back to forward splat.')
      return
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
          tNormal: { value: null },
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
        if (this.gbufferTarget.texture[3]) resolveMat.uniforms.tNormal.value = this.gbufferTarget.texture[3]
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

    // create 4 MRT attachments: color, pos, pbr, normal
    const mrt4 = new THREE.WebGLMultipleRenderTargets(size.x, size.y, 4)
    mrt4.texture[0].name = 'gColor'
    mrt4.texture[1].name = 'gPos'
    mrt4.texture[2].name = 'gPbr'
    mrt4.texture[3].name = 'gNormal'

    for (const tex of mrt4.texture) {
      tex.type = THREE.HalfFloatType
      tex.format = THREE.RGBAFormat
      tex.minFilter = THREE.NearestFilter
      tex.magFilter = THREE.NearestFilter
      tex.generateMipmaps = false
    }

    mrt4.depthBuffer = false
    this.gbufferTarget = mrt4

    const resolveMat = this.resolveMesh?.material as THREE.RawShaderMaterial | undefined
    if (resolveMat) {
      resolveMat.uniforms.tColor.value = mrt4.texture[0]
      resolveMat.uniforms.tPos.value = mrt4.texture[1]
      resolveMat.uniforms.tPbr.value = mrt4.texture[2]
      resolveMat.uniforms.tNormal.value = mrt4.texture[3]
    }
  }

  setDeferredMode() {
    this.deferredMode = (this.deferredMode + 1) % 4
    const resolveMat = this.resolveMesh?.material as THREE.RawShaderMaterial | null
    if (resolveMat) resolveMat.uniforms.uMode.value = this.deferredMode
  }

  setDataTexture(tex: THREE.DataTexture | null) {
    this.data_texture = tex
    // Deferred does not modify materials directly; the splat material will
    // be created/updated by GaussianSplatWebGL and provided at render time.
  }

  setIdxBuffer(tex: THREE.DataTexture | null) {
    this.idx_buffer = tex
    // stored for wiring into the provided gbuffer material during render
  }

  // Deferred does not keep material uniforms; these are applied to the
  // material provided at render time. We keep no matrix state here.

  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    gbufferMaterial: THREE.RawShaderMaterial | null,
  ) {
    if (!this.gbufferTarget || !this.resolveScene || !this.resolveCamera || !gbufferMaterial) return

    const size = new THREE.Vector2()
    renderer.getDrawingBufferSize(size)
    if (this.gbufferTarget.width !== size.x || this.gbufferTarget.height !== size.y) {
      this.resize(renderer, size.x, size.y)
      if (!this.gbufferTarget) return
    }

    // Wire stored textures/uniforms into the provided gbuffer material.
    if (gbufferMaterial.uniforms) {
      
      const viewMatrix = camera.matrixWorldInverse.elements as unknown as Float32Array
      const projectionMatrix = camera.projectionMatrix.elements as unknown as Float32Array
      const fx = camera.aspect

      if (this.data_texture && 'u_data' in gbufferMaterial.uniforms) gbufferMaterial.uniforms.u_data.value = this.data_texture
      if (this.idx_buffer && 'idx_buffer' in gbufferMaterial.uniforms) gbufferMaterial.uniforms.idx_buffer.value = this.idx_buffer
      if (viewMatrix && 'view' in gbufferMaterial.uniforms) gbufferMaterial.uniforms.view.value.fromArray(viewMatrix)
      if (projectionMatrix && 'projection' in gbufferMaterial.uniforms) gbufferMaterial.uniforms.projection.value.fromArray(projectionMatrix)
      if (typeof fx === 'number' && 'focal' in gbufferMaterial.uniforms) gbufferMaterial.uniforms.focal.value.set(fx, 1.0, 1.0)
    }

    const prevTarget = renderer.getRenderTarget()
    const prevClear = new THREE.Color()
    renderer.getClearColor(prevClear)
    const prevClearAlpha = renderer.getClearAlpha()

    renderer.setClearColor(0x000000, 0)

    // Render into MRT using the supplied material
    const firstMesh = (scene.children.find((c: any) => c.isMesh) as any) || null
    if (firstMesh) {
      const orig = firstMesh.material
      firstMesh.material = gbufferMaterial
      renderer.setRenderTarget(this.gbufferTarget)
      renderer.clear(true, false, false)
      renderer.render(scene, camera)
      firstMesh.material = orig
    } else {
      renderer.setRenderTarget(this.gbufferTarget)
      renderer.clear(true, false, false)
      renderer.render(scene, camera)
    }

    renderer.setRenderTarget(null)
    renderer.setClearColor(prevClear, prevClearAlpha)
    renderer.render(this.resolveScene, this.resolveCamera)
    renderer.setRenderTarget(prevTarget)
  }
}
