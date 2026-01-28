import * as THREE from 'three'
import { GaussianSplatWebGL } from './GaussianSplatWebGL'
import { DeferredWebGL } from './DeferredWebGL'

export class GaussianRendererWebGL {
  splat: GaussianSplatWebGL
  deferred: DeferredWebGL | null = null
  use_deferred: boolean = true

  constructor(use_deferred = true) {
    this.use_deferred = use_deferred
    this.splat = new GaussianSplatWebGL()
  }

  get mesh() {
    return this.splat.mesh
  }

  setBuffer(buffer: ArrayBuffer, vertexCount: number) {
    this.splat.setBuffer(buffer, vertexCount)
  }

  toggleVisible() {
    this.splat.toggleVisible()
  }

  setDeferredMode() {
    if (this.deferred) this.deferred.setDeferredMode()
  }

  initDeferred(renderer: THREE.WebGLRenderer) {
    if (!this.use_deferred) return
    if (!(renderer.capabilities as any).isWebGL2) {
      console.warn('Deferred requires WebGL2; skipping')
      return
    }
    if (!this.deferred) {
      this.deferred = new DeferredWebGL()
      if ((this.splat as any).data_texture) this.deferred.setDataTexture((this.splat as any).data_texture)
      if ((this.splat as any).idx_buffer) this.deferred.setIdxBuffer((this.splat as any).idx_buffer)
    }
    this.deferred.init(renderer)
  }

  resizeDeferred(renderer: THREE.WebGLRenderer, width?: number, height?: number) {
    if (this.deferred) this.deferred.resize(renderer, width, height)
  }

  updateUniforms(viewMatrix: Float32Array, projectionMatrix: Float32Array, fx: number, fy: number, fz: number) {
    this.splat.updateUniforms(viewMatrix, projectionMatrix, fx, fy, fz)
  }

  renderDeferred(renderer: THREE.WebGLRenderer, splatScene: THREE.Scene, camera: THREE.PerspectiveCamera, mainScene?: THREE.Scene) {
    if (this.use_deferred && this.deferred) {
      // create a gbuffer material from the splat implementation so it can
      // compile with the DEFERRED_GBUFFER define and carry the splat data
      const gbufferMat = (this.splat as any).createGBufferMaterial?.() ?? null

      this.deferred.render(renderer, splatScene, camera, gbufferMat)
      if (mainScene) {
        const prevAutoClear = (renderer as any).autoClear
        ;(renderer as any).autoClear = false
        renderer.render(mainScene, camera)
        ;(renderer as any).autoClear = prevAutoClear
      }
    } else {
      // Forward: render splatScene then mainScene
      renderer.render(splatScene, camera)
      if (mainScene) renderer.render(mainScene, camera)
    }
  }

  setUseDeferred(flag: boolean, renderer?: THREE.WebGLRenderer) {
    this.use_deferred = flag
    if (flag && renderer) this.initDeferred(renderer)
  }

  renderOverlay() {
    this.splat.renderOverlay()
  }
}
