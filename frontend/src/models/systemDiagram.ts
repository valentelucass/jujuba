export type NodeKind = 'start' | 'action' | 'decision' | 'end'
export type StagePosition = { x: number; y: number }
export interface SystemNode { id: string; kind: NodeKind; label: string; detail: string; position?: StagePosition }
export interface SystemEdge { from: string; to: string; label: string }

export interface SystemDiagram {
  title: string
  summary: string
  nodes: SystemNode[]
  edges: SystemEdge[]
  requirements: string[]
  openQuestions: string[]
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

export const nodeKinds: Record<NodeKind, string> = { start: 'Início', action: 'Ação', decision: 'Decisão', end: 'Fim' }

export function blankDiagram(): SystemDiagram {
  return {
    title: 'Novo fluxo',
    summary: '',
    nodes: [
      { id: 'start', kind: 'start', label: 'Início', detail: '' },
      { id: 'end', kind: 'end', label: 'Fim', detail: '' },
    ],
    edges: [{ from: 'start', to: 'end', label: '' }],
    requirements: [],
    openQuestions: [],
  }
}
