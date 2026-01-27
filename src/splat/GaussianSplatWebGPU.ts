import * as THREE from 'three'
import vertWGSL from './shaders/splat.vert.wgsl?raw'
import fragWGSL from './shaders/splat.frag.wgsl?raw'

export class GaussianSplatWebGPU {
  mesh: THREE.Object3D
  worker: Worker | null = null
  vertexCount = 0
  overlayCanvas: HTMLCanvasElement | null = null
  visible = true
  gpuInitPromise: Promise<void> | null = null

  gpu: {
    device: GPUDevice
    context: GPUCanvasContext
    format: GPUTextureFormat
    pipeline: GPURenderPipeline
    bindGroup: GPUBindGroup | null
    quadVertex: GPUBuffer
    quadIndex: GPUBuffer
    uniformBuffer: GPUBuffer
    sampler: GPUSampler
    splatTexture?: GPUTexture
    idxTexture?: GPUTexture
    vertexCount: number
  } | null = null

  constructor(count = 0) {
    this.mesh = new THREE.Group()
    this.mesh.visible = false

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

    this.gpuInitPromise = this.initWebGPU()
  }

  handleTexdata(texdata: Uint32Array, texwidth: number, texheight: number) {
    const floatArray = texdata instanceof ArrayBuffer ? new Float32Array(texdata) : new Float32Array((texdata as any).buffer || texdata)
    const upload = () => this.uploadSplatTexture(floatArray, texwidth, texheight)
    if (this.gpu) upload()
    else this.gpuInitPromise?.then(upload)
  }

  handleDepthIndex(depthIndex: Uint32Array, vertexCount: number) {
    const upload = () => this.uploadIndexTexture(depthIndex, vertexCount)
    if (this.gpu) upload()
    else this.gpuInitPromise?.then(upload)
  }

  setBuffer(buffer: ArrayBuffer, vertexCount: number) {
    if (!this.worker) return
    this.worker.postMessage({ buffer, vertexCount }, [buffer])
  }

  updateUniforms(viewMatrix: Float32Array, projectionMatrix: Float32Array, fx: number, fy: number, fz: number) {
    const write = () => {
      if (!this.gpu) return
      const uniformArray = new Float32Array(64)
      uniformArray.set(viewMatrix, 0)
      uniformArray.set(projectionMatrix, 16)
      uniformArray[32] = fx
      uniformArray[33] = fy
      uniformArray[34] = fz
      this.gpu.device.queue.writeBuffer(this.gpu.uniformBuffer, 0, uniformArray.buffer, 0, 256)
    }
    if (this.gpu) write()
    else this.gpuInitPromise?.then(write)

    if (!this.worker) return
    this.worker.postMessage({ view: viewMatrix })
  }

  toggleVisible() {
    this.visible = !this.visible
  }

  async initWebGPU() {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter()
      if (!adapter) throw new Error('No WebGPU adapter found')
      const device = await adapter.requestDevice()

      this.overlayCanvas = document.createElement('canvas')
      Object.assign(this.overlayCanvas.style, {
        position: 'fixed',
        inset: '0px',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: '1'
      })
      document.body.appendChild(this.overlayCanvas)
      const context = this.overlayCanvas.getContext('webgpu') as GPUCanvasContext
      const format = (navigator as any).gpu.getPreferredCanvasFormat()
      const resize = () => {
        if (!this.overlayCanvas) return
        this.overlayCanvas.width = window.innerWidth * devicePixelRatio
        this.overlayCanvas.height = window.innerHeight * devicePixelRatio
        context.configure({ device, format, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT })
      }
      resize()
      window.addEventListener('resize', resize)

      const quad = new Float32Array([
        -1, -1, 0,
         1, -1, 0,
         1,  1, 0,
        -1,  1, 0,
      ])
      const quadVertex = device.createBuffer({ size: quad.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, mappedAtCreation: true })
      new Float32Array(quadVertex.getMappedRange()).set(quad)
      quadVertex.unmap()

      const indices = new Uint16Array([0,1,2,2,3,0])
      const quadIndex = device.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, mappedAtCreation: true })
      new Uint16Array(quadIndex.getMappedRange()).set(indices)
      quadIndex.unmap()

      const uniformBuffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })

      const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })

      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'uint' } },
          { binding: 1, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'unfilterable-float' } },
          { binding: 2, visibility: GPUShaderStage.VERTEX, sampler: { type: 'non-filtering' } },
          { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ]
      })

      const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: {
          module: device.createShaderModule({ code: vertWGSL }),
          entryPoint: 'main',
          buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, format: 'float32x3', offset: 0 }] }],
        },
        fragment: {
          module: device.createShaderModule({ code: fragWGSL }),
          entryPoint: 'main',
          targets: [{ format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
      })

      this.gpu = { device, context, format, pipeline, bindGroup: null, quadVertex, quadIndex, uniformBuffer, sampler, vertexCount: 0 }
    } catch (err) {
      console.warn('WebGPU init failed', err)
    }
  }

  uploadSplatTexture(data: Float32Array, width: number, height: number) {
    if (!this.gpu) return
    const { device } = this.gpu
    const texture = device.createTexture({ size: { width, height }, format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
    device.queue.writeTexture({ texture }, data, { bytesPerRow: width * 16 }, { width, height })
    this.gpu.splatTexture = texture
    this.tryCreateBindGroup()
  }

  uploadIndexTexture(data: Uint32Array, vertexCount: number) {
    if (!this.gpu) return
    const width = 1024
    const height = Math.ceil(vertexCount / 1024)
    const texture = this.gpu.device.createTexture({ size: { width, height }, format: 'r32uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
    this.gpu.device.queue.writeTexture({ texture }, data, { bytesPerRow: width * 4 }, { width, height })
    this.gpu.idxTexture = texture
    this.gpu.vertexCount = vertexCount
    this.tryCreateBindGroup()
  }

  tryCreateBindGroup() {
    if (!this.gpu || !this.gpu.splatTexture || !this.gpu.idxTexture) return
    const layout = this.gpu.pipeline.getBindGroupLayout(0)
    this.gpu.bindGroup = this.gpu.device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: this.gpu.idxTexture.createView() },
        { binding: 1, resource: this.gpu.splatTexture.createView() },
        { binding: 2, resource: this.gpu.sampler },
        { binding: 3, resource: { buffer: this.gpu.uniformBuffer } },
      ],
    })
  }

  renderOverlay() {
    if (!this.gpu || !this.gpu.bindGroup || !this.visible || this.gpu.vertexCount === 0) return
    const { device, context, pipeline, quadVertex, quadIndex, bindGroup } = this.gpu
    const encoder = device.createCommandEncoder()
    const view = context.getCurrentTexture().createView()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.setVertexBuffer(0, quadVertex)
    pass.setIndexBuffer(quadIndex, 'uint16')
    pass.drawIndexed(6, this.gpu.vertexCount, 0, 0, 0)
    pass.end()
    device.queue.submit([encoder.finish()])
  }
}
