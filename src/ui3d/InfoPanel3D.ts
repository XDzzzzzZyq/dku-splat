import * as THREE from 'three'

type InfoPanelOptions = {
  width?: number
  height?: number
  billboard?: boolean
  title?: string
  description?: string
}

export class InfoPanel3D extends THREE.Group {
  readonly panelMesh: THREE.Mesh
  readonly textMesh: THREE.Mesh
  readonly closeButtonMesh: THREE.Mesh
  readonly interactables: THREE.Object3D[]

  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly texture: THREE.CanvasTexture
  private readonly billboard: boolean
  private visibleState = true

  constructor(options: InfoPanelOptions = {}) {
    super()

    const width = options.width ?? 1.2
    const height = options.height ?? 0.7
    this.billboard = options.billboard ?? true

    const panelGeometry = new THREE.BoxGeometry(width, height, 0.04, 3, 3, 1)
    const panelMaterial = new THREE.MeshStandardMaterial({
      color: 0x1d2630,
      metalness: 0.1,
      roughness: 0.7,
    })
    this.panelMesh = new THREE.Mesh(panelGeometry, panelMaterial)
    this.add(this.panelMesh)

    this.canvas = document.createElement('canvas')
    this.canvas.width = 1024
    this.canvas.height = 640

    const context = this.canvas.getContext('2d')
    if (!context) {
      throw new Error('Could not create 2D context for InfoPanel3D')
    }
    this.context = context

    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace

    const textGeometry = new THREE.PlaneGeometry(width * 0.92, height * 0.88)
    const textMaterial = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
    })
    this.textMesh = new THREE.Mesh(textGeometry, textMaterial)
    this.textMesh.position.z = 0.024
    this.add(this.textMesh)

    this.closeButtonMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xb33a3a, metalness: 0.1, roughness: 0.5 })
    )
    this.closeButtonMesh.position.set(width / 2 - 0.08, height / 2 - 0.08, 0.03)
    this.closeButtonMesh.userData.onClick = () => this.setVisible(false)
    this.add(this.closeButtonMesh)

    this.interactables = [this.closeButtonMesh]

    this.setContent(
      options.title ?? 'Info Panel',
      options.description ?? 'This is a 3D panel.\nYou can update its content dynamically.'
    )
  }

  setVisible(value: boolean) {
    this.visibleState = value
    this.visible = value
  }

  toggle() {
    this.setVisible(!this.visibleState)
  }

  setContent(title: string, description: string) {
    const ctx = this.context

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    ctx.fillStyle = '#0e1319'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

    ctx.strokeStyle = '#4e5f72'
    ctx.lineWidth = 10
    ctx.strokeRect(8, 8, this.canvas.width - 16, this.canvas.height - 16)

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 64px sans-serif'
    ctx.fillText(title, 50, 90)

    ctx.fillStyle = '#dbe8f5'
    ctx.font = '40px sans-serif'

    const maxWidth = this.canvas.width - 100
    const words = description.split(/\s+/)
    const lines: string[] = []
    let currentLine = ''

    for (const rawWord of words) {
      const parts = rawWord.split('\n')
      for (let i = 0; i < parts.length; i++) {
        const word = parts[i]
        const probe = currentLine ? `${currentLine} ${word}` : word
        if (ctx.measureText(probe).width > maxWidth && currentLine) {
          lines.push(currentLine)
          currentLine = word
        } else {
          currentLine = probe
        }

        if (i < parts.length - 1) {
          lines.push(currentLine)
          currentLine = ''
        }
      }
    }
    if (currentLine) lines.push(currentLine)

    let y = 170
    for (const line of lines) {
      ctx.fillText(line, 50, y)
      y += 56
      if (y > this.canvas.height - 50) break
    }

    this.texture.needsUpdate = true
  }

  update(camera: THREE.Camera) {
    if (!this.billboard || !this.visible) return
    this.lookAt(camera.position)
  }
}
