export type Vec2 = readonly [number, number]
export type Vec3 = readonly [number, number, number]

export type LocationId = 'classroom' | 'campus_main_gate'

export interface LocationInfoMetadata {
  id: string
  title: string
  description: string
  buttonPosition: Vec3
  panelOffset: Vec2
  cameraTarget?: Vec3
}

export interface LocationMetadata {
  id: LocationId
  infos: readonly LocationInfoMetadata[]
}

export const LOCATION_METADATA: Record<LocationId, LocationMetadata> = {
  classroom: {
    id: 'classroom',
    infos: [
      {
        id: 'classroom_front_screen',
        title: 'Lecture Screen',
        description: 'Main teaching display used for presentations and demonstrations.',
        buttonPosition: [0.55, 0.15, -0.45],
        panelOffset: [16, -64],
        cameraTarget: [0.35, -0.12, -0.5]
      },
      {
        id: 'classroom_collab_zone',
        title: 'Collaboration Zone',
        description: 'A flexible area where students gather for team activities and discussions.',
        buttonPosition: [0.25, -0.1, -0.18],
        panelOffset: [16, -64]
      }
    ]
  },
  campus_main_gate: {
    id: 'campus_main_gate',
    infos: [
      {
        id: 'main_gate_entry',
        title: 'Main Gate',
        description: 'Primary access point connecting visitors to campus pathways and facilities.',
        buttonPosition: [0.8, 0.2, -0.2],
        panelOffset: [16, -64],
        cameraTarget: [0.55, -0.1, -0.35]
      }
    ]
  }
}
