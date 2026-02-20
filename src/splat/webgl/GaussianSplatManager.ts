import * as THREE from 'three'
import { GaussianSplatWebGL } from './GaussianSplatWebGL'
import { CONFIG } from '../../config'

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

    const entries = this.splats.map((splat) => {
        const trunkCenter = splat.mesh.userData.trunkCenter as THREE.Vector3 | undefined
        const worldCenter = trunkCenter ?? new THREE.Vector3(
          splat.mesh.matrixWorld.elements[12],
          splat.mesh.matrixWorld.elements[13],
          splat.mesh.matrixWorld.elements[14],
        )

        const viewZ =
          viewMatrix[2] * worldCenter.x +
          viewMatrix[6] * worldCenter.y +
          viewMatrix[10] * worldCenter.z +
          viewMatrix[14]

        return { splat, viewZ, isTrunk: !!trunkCenter }
      })

    const trunkEntries = entries
      .filter((entry) => entry.isTrunk)
      .sort((a, b) => b.viewZ - a.viewZ)

    if (trunkEntries.length > 0) {
      const maxVisible = Math.max(1, CONFIG.MAX_VISIBLE_TRUNKS)
      for (let i = 0; i < trunkEntries.length; i += 1) {
        trunkEntries[i].splat.mesh.visible = i < maxVisible
      }
    }

    const ordered = entries
      .filter((entry) => entry.splat.mesh.visible)
      // Near-to-far ordering: larger viewZ is nearer for points in front of the camera.
      .sort((a, b) => b.viewZ - a.viewZ)

    for (let i = 0; i < ordered.length; i += 1) {
      ordered[i].splat.mesh.renderOrder = i
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
