
import type { NodeKind, StagePosition, SystemDiagram } from './systemDiagram'

export const stageGeometry: Record<NodeKind, { width: number; height: number; outline: string; detail?: string }> = {
  start: { width: 190, height: 64, outline: 'M32 1H158a31 31 0 0 1 0 62H32a31 31 0 0 1 0-62Z' },
  end: { width: 190, height: 64, outline: 'M32 1H158a31 31 0 0 1 0 62H32a31 31 0 0 1 0-62Z' },
  action: { width: 190, height: 64, outline: 'M1 1H189V63H1Z' },
  decision: { width: 228, height: 126, outline: 'M114 1 227 63 114 125 1 63Z' },
  inputOutput: { width: 198, height: 70, outline: 'M24 1H197L174 69H1Z' },
  document: { width: 190, height: 74, outline: 'M1 1H189V62C113 29 72 96 1 62Z' },
  subprocess: { width: 190, height: 68, outline: 'M1 1H189V67H1Z', detail: 'M16 1V67M174 1V67' },
  connector: { width: 88, height: 88, outline: 'M44 1a43 43 0 1 1 0 86 43 43 0 1 1 0-86Z' },
  extract: { width: 190, height: 120, outline: 'M95 1 189 119H1Z' },
}

export type FlowPreview = Pick<SystemDiagram, 'nodes' | 'edges'>

export function arrangeStages(diagram: FlowPreview): Map<string, StagePosition> {
  const start = diagram.nodes.find((node) => node.kind === 'start')?.id
  const distance = new Map<string, number>()
  if (start) {
    const pending = [start]
    distance.set(start, 0)
    for (const id of pending) {
      for (const edge of diagram.edges) {
        if (edge.from === id && !distance.has(edge.to)) {
          distance.set(edge.to, distance.get(id)! + 1)
          pending.push(edge.to)
        }
      }
    }
  }
  const later = Math.max(-1, ...distance.values()) + 1
  const rows = new Map<number, string[]>()
  let unconnected = 0
  for (const node of diagram.nodes) {
    if (!distance.has(node.id)) distance.set(node.id, later + Math.floor(unconnected++ / 4))
    const row = distance.get(node.id)!
    rows.set(row, [...(rows.get(row) ?? []), node.id])
  }
  return new Map(diagram.nodes.map(({ id, kind, position }) => {
    const row = distance.get(id)!
    const members = rows.get(row)!
    return [id, position ?? {
      x: (members.indexOf(id) - (members.length - 1) / 2) * 268 + (190 - stageGeometry[kind].width) / 2,
      y: row * 166,
    }]
  }))
}
