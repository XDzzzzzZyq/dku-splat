import * as THREE from 'three'
import { GaussianSplatWebGL } from './GaussianSplatWebGL'
import { CONFIG } from '../../config'

export type GBufferEntry = {
  mesh: THREE.Mesh
  material: THREE.RawShaderMaterial
}

type ChunkBounds = {
  min: [number, number, number]
  max: [number, number, number]
}

type ChunkData = {
  id: string
  file: string
  bounds: ChunkBounds
  vertexCount: number
}

type ChunkMetaResponse = {
  scene: string
  trunk_size: number
  total_vertex: number
  chunks: ChunkData[]
}

type RuntimeChunk = ChunkData & {
  box: THREE.Box3
  center: THREE.Vector3
}

export class GaussianSplatManager {
  splats: GaussianSplatWebGL[] = []
  group: THREE.Group = new THREE.Group()
  runtimeChunks: RuntimeChunk[] = []
  loadedChunkIds: Set<string> = new Set<string>()
  loadingChunkIds: Set<string> = new Set<string>()
  chunkStreamingEnabled = false
  chunkSweepInFlight = false
  frameCounter = 0
  chunkFetchIntervalFrames = 6
  maxChunksPerSweep = 4
  chunkServerBaseUrl = 'http://localhost:8000'
  chunkSceneName = ''
  frustum = new THREE.Frustum()
  frustumMatrix = new THREE.Matrix4()

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

  toRuntimeChunk(chunk: ChunkData): RuntimeChunk {
    const min = new THREE.Vector3(chunk.bounds.min[0], chunk.bounds.min[1], chunk.bounds.min[2])
    const max = new THREE.Vector3(chunk.bounds.max[0], chunk.bounds.max[1], chunk.bounds.max[2])
    const box = new THREE.Box3(min, max)
    const center = box.getCenter(new THREE.Vector3())
    return { ...chunk, box, center }
  }

  collectCameraCoveredChunks(camera: THREE.PerspectiveCamera): RuntimeChunk[] {
    this.frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.frustumMatrix)

    const covered = this.runtimeChunks.filter((chunk) => this.frustum.intersectsBox(chunk.box))
    const candidates = covered.length > 0 ? covered : this.runtimeChunks

    return candidates
      .slice()
      .sort((a, b) => camera.position.distanceToSquared(a.center) - camera.position.distanceToSquared(b.center))
      .slice(0, Math.max(1, CONFIG.MAX_VISIBLE_TRUNKS))
  }

  async fetchChunkById(chunk: RuntimeChunk): Promise<void> {
    if (this.loadedChunkIds.has(chunk.id) || this.loadingChunkIds.has(chunk.id)) return

    this.loadingChunkIds.add(chunk.id)
    try {
      const chunkRes = await fetch(
        `${this.chunkServerBaseUrl}/load_chunk?filename=${encodeURIComponent(this.chunkSceneName)}&chunk_id=${encodeURIComponent(chunk.id)}`,
      )
      if (!chunkRes.ok) throw new Error(`Failed to fetch chunk ${chunk.id}`)

      const buffer = await chunkRes.arrayBuffer()
      const headerVertexCount = Number(chunkRes.headers.get('n-vertex'))
      const vertexCount = Number.isFinite(headerVertexCount) && headerVertexCount > 0
        ? Math.floor(headerVertexCount)
        : chunk.vertexCount

      const splat = this.addSplatBuffer(buffer, vertexCount)
      if (splat?.mesh) {
        splat.mesh.userData.trunkCenter = chunk.center.clone()
      }

      this.loadedChunkIds.add(chunk.id)
    } finally {
      this.loadingChunkIds.delete(chunk.id)
    }
  }

  async sweepAndLoadCoveredChunks(camera: THREE.PerspectiveCamera): Promise<void> {
    if (!this.chunkStreamingEnabled || this.chunkSweepInFlight || this.runtimeChunks.length === 0) return

    this.chunkSweepInFlight = true
    try {
      const covered = this.collectCameraCoveredChunks(camera)
      const pending = covered
        .filter((chunk) => !this.loadedChunkIds.has(chunk.id) && !this.loadingChunkIds.has(chunk.id))
        .slice(0, this.maxChunksPerSweep)

      if (pending.length > 0) {
        await Promise.all(pending.map((chunk) => this.fetchChunkById(chunk)))
      }
    } finally {
      this.chunkSweepInFlight = false
    }
  }

  async initChunkStreaming(sceneName: string, serverBaseUrl = 'http://localhost:8000'): Promise<void> {
    this.chunkSceneName = sceneName
    this.chunkServerBaseUrl = serverBaseUrl
    this.runtimeChunks = []
    this.loadedChunkIds.clear()
    this.loadingChunkIds.clear()
    this.chunkStreamingEnabled = false

    const chunkMetaRes = await fetch(
      `${this.chunkServerBaseUrl}/get_chunk_meta?filename=${encodeURIComponent(this.chunkSceneName)}`,
    )
    if (!chunkMetaRes.ok) throw new Error(`Failed to fetch chunk metadata for ${sceneName}`)

    const chunkPayload = (await chunkMetaRes.json()) as ChunkMetaResponse
    if (!Array.isArray(chunkPayload.chunks) || chunkPayload.chunks.length === 0) {
      throw new Error('No scene chunks loaded')
    }

    this.runtimeChunks = chunkPayload.chunks.map((chunk) => this.toRuntimeChunk(chunk))
    this.chunkStreamingEnabled = true
  }

  updateChunkStreaming(camera: THREE.PerspectiveCamera) {
    if (!this.chunkStreamingEnabled) return

    this.frameCounter += 1
    if (this.frameCounter % this.chunkFetchIntervalFrames === 0) {
      void this.sweepAndLoadCoveredChunks(camera)
    }
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
      .sort((a, b) => a.viewZ - b.viewZ)

    if (trunkEntries.length > 0) {
      const maxVisible = Math.max(1, CONFIG.MAX_VISIBLE_TRUNKS)
      for (let i = 0; i < trunkEntries.length; i += 1) {
        trunkEntries[i].splat.mesh.visible = i < maxVisible
      }
    }

    const ordered = entries
      .filter((entry) => entry.splat.mesh.visible)
      // Near-to-far ordering: larger viewZ is nearer for points in front of the camera.
      .sort((a, b) => a.viewZ - b.viewZ)

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
