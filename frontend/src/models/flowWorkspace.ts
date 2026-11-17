
import type { MascotMeeting, MascotPresence } from './flowMascot'
import type { DiagramProject, StagePosition, SystemDiagram } from './systemDiagram'

export type FlowProjectEntry = { id: string; title: string; preview: Pick<SystemDiagram, "nodes" | "edges"> }
export interface FlowProject {
  id: string
  diagram: SystemDiagram
  file: DiagramProject | null
  fileDirty: boolean
  returningGuest?: boolean
}

export interface FlowSession {
  id: string
  projectId: string | null
  phase: 'starting' | 'available' | 'inviting' | 'joining' | 'approval' | 'connected' | 'ended'
  code: string | null
  peer: string | null
  canEdit: boolean
  cursor: StagePosition | null
  mascotSupported?: boolean
  mascotVersion?: number
  mascot?: MascotPresence | null
  mascotMeeting?: MascotMeeting | null
  diagram: SystemDiagram | null
  revision: number
  message: string | null
  trustedPeer?: string | null
  returnCode?: string | null
}

export type FlowCommand =
  | { type: 'reject' | 'invite' | 'revoke' }
  | { type: 'accept'; remember: boolean }
  | { type: 'edit'; before: SystemDiagram; diagram: SystemDiagram }
  | { type: 'cursor'; position: StagePosition | null }
  | { type: 'mascot'; mascot: MascotPresence | null }
  | { type: 'mascotMeeting'; meeting: MascotMeeting }
