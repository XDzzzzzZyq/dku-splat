import * as THREE from 'three'
import { GaussianSplatWebGL } from './GaussianSplatWebGL'

export type GBufferEntry = {
  mesh: THREE.Mesh
  material: THREE.RawShaderMaterial
}

export class GaussianSplatManager {
  splats: GaussianSplatWebGL[] = []
  group: THREE.Group = new THREE.Group()

  get mesh(): THREE.Group {
    return this.group
  }

  addSplat(count = 0): GaussianSplatWebGL {
    const splat = new GaussianSplatWebGL(count)
    this.splats.push(splat)
    this.group.add(splat.mesh)
    return splat
  }

  addSplatBuffer(buffer: ArrayBuffer, vertexCount: number): GaussianSplatWebGL {
    const splat = this.addSplat(vertexCount)
    splat.setBuffer(buffer, vertexCount)
    return splat
  }

  setBuffer(buffer: ArrayBuffer, vertexCount: number) {
    if (this.splats.length === 0) {
      this.addSplatBuffer(buffer, vertexCount)
      return
    }
    this.splats[0].setBuffer(buffer, vertexCount)
  }

  updateUniforms(viewMatrix: Float32Array, projectionMatrix: Float32Array, fx: number, fy: number, fz: number) {
    for (const splat of this.splats) {
      splat.updateUniforms(viewMatrix, projectionMatrix, fx, fy, fz)
    }
  }

  getGBufferEntries(): GBufferEntry[] {
    return this.splats
      .map((splat) => ({
        mesh: splat.mesh,
        material: splat.createGBufferMaterial(),
      }))
      .filter((entry) => entry.mesh.visible)
  }

  toggleVisible() {
    for (const splat of this.splats) {
      splat.toggleVisible()
    }
  }

  renderOverlay() {
    for (const splat of this.splats) {
      splat.renderOverlay()
    }
  }
}
