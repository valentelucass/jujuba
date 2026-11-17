
import type { DiagramProject, StagePosition, SystemDiagram } from './systemDiagram'

export type FlowProjectEntry = { id: string; title: string; preview: Pick<SystemDiagram, "nodes" | "edges"> }
export interface FlowProject {
  id: string
  diagram: SystemDiagram
  file: DiagramProject | null
  fileDirty: boolean
}

export interface FlowSession {
  id: string
  projectId: string | null
  phase: 'starting' | 'inviting' | 'joining' | 'approval' | 'connected' | 'ended'
  code: string | null
  peer: string | null
  canEdit: boolean
  cursor: StagePosition | null
  diagram: SystemDiagram | null
  revision: number
  message: string | null
}

export type FlowCommand =
  | { type: 'accept' | 'reject' | 'passEdit' }
  | { type: 'edit'; diagram: SystemDiagram }
  | { type: 'cursor'; position: StagePosition | null }
