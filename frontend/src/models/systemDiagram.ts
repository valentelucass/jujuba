export type NodeKind = 'start' | 'action' | 'decision' | 'inputOutput' | 'document' | 'subprocess' | 'connector' | 'extract' | 'end'
export type StagePosition = { x: number; y: number }
export interface SystemNode { id: string; kind: NodeKind; label: string; detail: string; position?: StagePosition }
export interface FlowNote { id: string; text: string; position: StagePosition }
export const MAX_FLOW_NOTES = 16
export const MAX_FLOW_NOTE_TEXT = 480

export interface SystemEdge { from: string; to: string; label: string }

export interface SystemDiagram {
  title: string
  summary: string
  nodes: SystemNode[]
  edges: SystemEdge[]
  requirements: string[]
  openQuestions: string[]
  notes?: FlowNote[]
}

export interface DiagramProject { path: string; revision: string }
export interface OpenedDiagram { diagram: SystemDiagram; project: DiagramProject }
export interface GeneratedFile { path: string; content: string }
export interface GeneratedProject { files: GeneratedFile[] }

export type AiProvider = 'codex' | 'claude' | 'gemini'
export type ChatMessage = { role: 'user' | 'assistant'; content: string }
export type ReferenceDocument = { name: string; text: string }
export type AssistantReply = { reply: string; diagram: SystemDiagram | null }
export interface AssistantRequest {
  prompt: string
  screen: string
  history: ChatMessage[]
  documents: ReferenceDocument[]
  diagram: SystemDiagram | null
}

export const nodeKinds: Record<NodeKind, string> = {
  start: 'Início',
  action: 'Processo',
  decision: 'Decisão',
  inputOutput: 'Entrada e saída',
  document: 'Documento',
  subprocess: 'Subprocesso',
  connector: 'Conector',
  extract: 'Extração',
  end: 'Fim',
}

export const emptyDiagram: SystemDiagram = {
  title: 'Novo fluxo', summary: '', nodes: [], edges: [], requirements: [], openQuestions: [],
}
