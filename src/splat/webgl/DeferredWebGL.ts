import * as THREE from 'three'
import deferredVert from './shaders/deferred.vert?raw'
import deferredFrag from './shaders/deferred.frag?raw'
import type { GBufferEntry } from './GaussianSplatManager'
import { CONFIG } from '../../config'

export class DeferredWebGL {
  gbufferMaterial: THREE.RawShaderMaterial | null = null
  gbufferTarget: THREE.WebGLMultipleRenderTargets | null = null
  resolveScene: THREE.Scene | null = null
  resolveCamera: THREE.OrthographicCamera | null = null
  resolveMesh: THREE.Mesh | null = null
  deferredMode = 2
  env_texture: THREE.CubeTexture | null = null

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
          uEnvMap: { value: null },
          uEnvMapEnabled: { value: 0.0 },
          uMode: { value: this.deferredMode },
          uProj: { value: new THREE.Matrix4() },
          uInvProj: { value: new THREE.Matrix4() },
          uCamTrans: { value: new THREE.Matrix4() },
          uCameraPos: { value: new THREE.Vector3() },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uMaxDistance: { value: 10.0 },
          uStride: { value: 0.01 },
          uMaxSteps: { value: 256 },
          uThickness: { value: 0.001 },
          uJitter: { value: 0.5 },
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

      if (this.env_texture) {
        resolveMat.uniforms.uEnvMap.value = this.env_texture
        resolveMat.uniforms.uEnvMapEnabled.value = 1.0
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

  setEnvironmentMap(buffer: ArrayBuffer) {
    const floats = new Float32Array(buffer)
    const facePixels = floats.length / (6 * 4) // 6 faces, RGBA
    const faceSize = Math.round(Math.sqrt(facePixels))
    if (!Number.isFinite(faceSize) || faceSize <= 0 || faceSize * faceSize * 6 * 4 !== floats.length) {
      throw new Error('Environment map buffer size is invalid')
    }

    const faceTextures: THREE.DataTexture[] = []
    const faceStride = faceSize * faceSize * 4
    for (let f = 0; f < 6; f += 1) {
      const offsetBytes = f * faceStride * 4
      const faceRgba = new Float32Array(buffer, offsetBytes, faceStride)
      const faceTex = new THREE.DataTexture(faceRgba, faceSize, faceSize, THREE.RGBAFormat, THREE.FloatType)
      faceTex.needsUpdate = true
      faceTextures.push(faceTex)
    }

    const cube = new THREE.CubeTexture()
    cube.images = faceTextures as any
    cube.format = THREE.RGBAFormat
    cube.type = THREE.FloatType
    cube.magFilter = THREE.LinearFilter
    cube.minFilter = THREE.LinearFilter
    cube.wrapS = THREE.ClampToEdgeWrapping
    cube.wrapT = THREE.ClampToEdgeWrapping
    cube.generateMipmaps = false
    cube.needsUpdate = true
    this.env_texture = cube

    const resolveMat = this.resolveMesh?.material as THREE.RawShaderMaterial | null
    if (resolveMat?.uniforms) {
      resolveMat.uniforms.uEnvMap.value = cube
      resolveMat.uniforms.uEnvMapEnabled.value = 1.0
    }
  }

  // Deferred does not keep material uniforms; these are applied to the
  // material provided at render time. We keep no matrix state here.

  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    gbufferEntries: GBufferEntry[],
  ) {
    if (!this.gbufferTarget || !this.resolveScene || !this.resolveCamera || gbufferEntries.length === 0) return

    const size = new THREE.Vector2()
    renderer.getDrawingBufferSize(size)
    if (this.gbufferTarget.width !== size.x || this.gbufferTarget.height !== size.y) {
      this.resize(renderer, size.x, size.y)
      if (!this.gbufferTarget) return
    }

    const resolveMat = this.resolveMesh?.material as THREE.RawShaderMaterial | null
    if (resolveMat?.uniforms) {
      const viewProj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      const cameraPos = new THREE.Vector3()
      camera.getWorldPosition(cameraPos)

      if (resolveMat.uniforms.uProj) resolveMat.uniforms.uProj.value.copy(viewProj)
      if (resolveMat.uniforms.uInvProj) resolveMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse)
      if (resolveMat.uniforms.uCamTrans) resolveMat.uniforms.uCamTrans.value.copy(camera.matrixWorld)
      if (resolveMat.uniforms.uCameraPos) resolveMat.uniforms.uCameraPos.value.copy(cameraPos)
      if (resolveMat.uniforms.uResolution) resolveMat.uniforms.uResolution.value.set(size.x, size.y)
    }

    const prevTarget = renderer.getRenderTarget()
    const prevClear = new THREE.Color()
    renderer.getClearColor(prevClear)
    const prevClearAlpha = renderer.getClearAlpha()

    renderer.setClearColor(0x000000, 0)

    // Render into MRT using per-splat G-buffer materials
    const swaps: Array<{ mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] }> = []
    for (const entry of gbufferEntries) {
      swaps.push({ mesh: entry.mesh, original: entry.mesh.material })
      entry.mesh.material = entry.material
    }

    renderer.setRenderTarget(this.gbufferTarget)
    renderer.clear(true, false, false)
    renderer.render(scene, camera)

    for (const swap of swaps) {
      swap.mesh.material = swap.original
    }

    renderer.setRenderTarget(null)
    renderer.setClearColor(prevClear, prevClearAlpha)
    renderer.render(this.resolveScene, this.resolveCamera)
    renderer.setRenderTarget(prevTarget)
  }
}
