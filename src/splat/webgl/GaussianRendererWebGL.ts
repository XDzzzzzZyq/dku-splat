import * as THREE from 'three'
import { GaussianSplatManager } from './GaussianSplatManager'
import { DeferredWebGL } from './DeferredWebGL'
import { CONFIG } from "../../config.js"

export class GaussianRendererWebGL {
  manager: GaussianSplatManager
  deferred: DeferredWebGL | null = null
  use_deferred: boolean = CONFIG.USE_DEFERRED_RENDERING

  constructor() {
    this.manager = new GaussianSplatManager()
  }

  get mesh() {
    return this.manager.mesh
  }

  setBuffer(buffer: ArrayBuffer, vertexCount: number) {
    this.manager.setBuffer(buffer, vertexCount)
  }

  addSplatBuffer(buffer: ArrayBuffer, vertexCount: number) {
    return this.manager.addSplatBuffer(buffer, vertexCount)
  }

  setEnvironmentMap(buffer: ArrayBuffer) {
    if (!this.deferred) this.deferred = new DeferredWebGL()
    this.deferred.setEnvironmentMap(buffer)
  }

  toggleVisible() {
    this.manager.toggleVisible()
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
    }
    this.deferred.init(renderer)
  }

  resizeDeferred(renderer: THREE.WebGLRenderer, width?: number, height?: number) {
    if (this.deferred) this.deferred.resize(renderer, width, height)
  }

  updateUniforms(viewMatrix: Float32Array, projectionMatrix: Float32Array, fx: number, fy: number, fz: number) {
    this.manager.updateUniforms(viewMatrix, projectionMatrix, fx, fy, fz)
  }

  renderDeferred(renderer: THREE.WebGLRenderer, splatScene: THREE.Scene, camera: THREE.PerspectiveCamera, mainScene?: THREE.Scene) {
    if (this.use_deferred && this.deferred) {
      const gbufferEntries = this.manager.getGBufferEntries()
      this.deferred.render(renderer, splatScene, camera, gbufferEntries)
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
    this.manager.renderOverlay()
  }
}
