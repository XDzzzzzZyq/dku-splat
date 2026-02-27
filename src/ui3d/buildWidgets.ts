import * as THREE from 'three'
import { Button3D } from './Button3D'

export type WidgetLocationMetadata = {
  id: string
  label: string
  details?: string
  buttonPosition: [number, number, number]
  panelOffset?: [number, number, number]
  buttonColor?: number
  panelColor?: number
  keepOthersOpen?: boolean
  onSelect?: () => void
}

export type WidgetState = {
  openPanelId: string | null
}

export type InteractionManager = {
  registerClickable: (object: THREE.Object3D) => void
}

export type WidgetBuildResult = {
  updateHooks: Array<() => void>
}

const defaultPanelOffset: [number, number, number] = [0.35, 0, 0]

function createTextTexture(title: string, details?: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const context = canvas.getContext('2d')

  if (!context) {
    return new THREE.CanvasTexture(canvas)
  }

  context.fillStyle = 'rgba(10, 18, 30, 0.9)'
  context.fillRect(0, 0, canvas.width, canvas.height)

  context.strokeStyle = 'rgba(91, 145, 255, 1)'
  context.lineWidth = 4
  context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16)

  context.fillStyle = 'white'
  context.font = 'bold 42px sans-serif'
  context.fillText(title, 24, 70)

  if (details) {
    context.fillStyle = 'rgba(225, 232, 255, 0.95)'
    context.font = '28px sans-serif'
    context.fillText(details, 24, 130)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

export function buildWidgets(
  scene: THREE.Scene,
  interactionManager: InteractionManager,
  selectedLocationMetadata: WidgetLocationMetadata[],
  state: WidgetState
): WidgetBuildResult {
  const updateHooks: Array<() => void> = []

  const pairs = selectedLocationMetadata.map((metadata) => {
    const button = new Button3D(metadata.buttonColor ?? 0x3366ff)
    button.position.fromArray(metadata.buttonPosition)

    const panelTexture = createTextTexture(metadata.label, metadata.details)
    const panelMaterial = new THREE.MeshStandardMaterial({
      map: panelTexture,
      color: metadata.panelColor ?? 0x1a2440,
      transparent: true,
      opacity: 0.95,
    })
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), panelMaterial)
    panel.visible = false
    panel.position.copy(button.position)
    panel.position.add(new THREE.Vector3(...(metadata.panelOffset ?? defaultPanelOffset)))

    const pulseData = { phase: Math.random() * Math.PI * 2 }
    const updateBillboard = () => {
      const activeCamera = scene.userData.camera as THREE.Camera | undefined
      if (activeCamera) {
        panel.lookAt(activeCamera.position)
      }
    }
    const updateAnimation = () => {
      pulseData.phase += 0.03
      button.scale.setScalar(1 + Math.sin(pulseData.phase) * 0.04)
    }

    button.userData.onClick = () => {
      const shouldOpen = state.openPanelId !== metadata.id

      if (!metadata.keepOthersOpen) {
        state.openPanelId = shouldOpen ? metadata.id : null
      }

      panel.visible = metadata.keepOthersOpen ? !panel.visible : state.openPanelId === metadata.id
      metadata.onSelect?.()
    }

    scene.add(button)
    scene.add(panel)
    interactionManager.registerClickable(button)

    updateHooks.push(updateBillboard, updateAnimation)

    return { metadata, panel }
  })

  updateHooks.push(() => {
    for (const { metadata, panel } of pairs) {
      if (!metadata.keepOthersOpen) {
        panel.visible = state.openPanelId === metadata.id
      }
    }
  })

  return { updateHooks }
}
