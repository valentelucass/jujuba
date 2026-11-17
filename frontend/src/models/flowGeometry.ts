import type { NodeKind, StagePosition, SystemDiagram } from './systemDiagram'

const frames: Record<NodeKind, { width: number; height: number; maxWidth: number; textWidth: number; textCenter: number }> = {
  start: { width: 190, height: 64, maxWidth: 304, textWidth: .76, textCenter: .5 },
  end: { width: 190, height: 64, maxWidth: 304, textWidth: .76, textCenter: .5 },
  action: { width: 190, height: 64, maxWidth: 316, textWidth: .82, textCenter: .5 },
  decision: { width: 228, height: 126, maxWidth: 352, textWidth: .56, textCenter: .5 },
  inputOutput: { width: 198, height: 70, maxWidth: 320, textWidth: .74, textCenter: .5 },
  document: { width: 190, height: 74, maxWidth: 316, textWidth: .82, textCenter: .42 },
  subprocess: { width: 190, height: 68, maxWidth: 316, textWidth: .78, textCenter: .5 },
  connector: { width: 116, height: 116, maxWidth: 200, textWidth: .75, textCenter: .5 },
  extract: { width: 190, height: 120, maxWidth: 324, textWidth: .52, textCenter: .72 },
}

export interface StageGeometry { width: number; height: number; labelWidth: number; labelY: number }

export function stageGeometry(kind: NodeKind, label = ''): StageGeometry {
  const frame = frames[kind]
  // Estimate in flow coordinates so peers with different zoom levels use the same bounds.
  const textWidth = Array.from(label.trim()).reduce((width, character) => {
    if (/[ilI1.,:;'!| ]/.test(character)) return width + 4
    if (/[MW@%]/.test(character) || character.codePointAt(0)! >= 0x2e80) return width + 12
    return width + 7.5
  }, 0)
  const preferredWidth = Math.ceil(textWidth / frame.textWidth / 4) * 4
  const width = Math.min(frame.maxWidth, Math.max(frame.width, preferredWidth))
  const labelWidth = Math.floor(width * frame.textWidth)
  const lines = Math.min(3, Math.max(1, Math.ceil(textWidth / labelWidth)))
  const lineGrowth = kind === 'decision' || kind === 'extract' ? 30 : 18
  const height = kind === 'connector' ? width : frame.height + (lines - 1) * lineGrowth
  return { width, height, labelWidth, labelY: height * frame.textCenter }
}

export type FlowPreview = Pick<SystemDiagram, 'nodes' | 'edges' | 'notes'>
export const NOTE_WIDTH = 260
export const NOTE_LINE_HEIGHT = 21

export function noteHeight(text: string) {
  const lines = text.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 29)), 0)
  return Math.max(38, lines * NOTE_LINE_HEIGHT + 16)
}

export function nextNotePosition(diagram: FlowPreview): StagePosition {
  const stages = arrangeStages(diagram)
  const x = Math.min(99_600, Math.max(260, ...stages.map(({ position, geometry }) => position.x + geometry.width + 48)))
  const bottom = (diagram.notes ?? []).filter((note) => Math.abs(note.position.x - x) < NOTE_WIDTH + 16)
    .map((note) => note.position.y + noteHeight(note.text) + 30)
  return { x, y: Math.min(99_000, Math.max(0, ...bottom)) }
}

export function arrangeStages(diagram: FlowPreview) {
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

  const layout = diagram.nodes.map((node) => ({ node, geometry: stageGeometry(node.kind, node.label) }))
  const later = Math.max(-1, ...distance.values()) + 1
  const rows = new Map<number, typeof layout>()
  let unconnected = 0
  for (const stage of layout) {
    const row = distance.get(stage.node.id) ?? later + Math.floor(unconnected++ / 4)
    const members = rows.get(row)
    if (members) members.push(stage)
    else rows.set(row, [stage])
  }

  const positions = new Map<string, StagePosition>()
  let y = 0
  for (const row of Array.from(rows.keys()).sort((first, second) => first - second)) {
    const members = rows.get(row)!
    const gap = 60
    const rowWidth = members.reduce((width, { geometry }) => width + geometry.width, gap * (members.length - 1))
    let x = 95 - rowWidth / 2
    for (const { node, geometry } of members) {
      positions.set(node.id, node.position ?? { x, y })
      x += geometry.width + gap
    }
    y += Math.max(166, Math.max(...members.map(({ geometry }) => geometry.height)) + 48)
  }

  return layout.map((stage) => ({ ...stage, position: positions.get(stage.node.id)! }))
}

export function stageOutline(kind: NodeKind, { width, height }: StageGeometry) {
  const right = width - 1
  const bottom = height - 1
  const center = width / 2
  const middle = height / 2
  switch (kind) {
    case 'start':
    case 'end': {
      const radius = middle - 1
      return { outline: `M${middle} 1H${width - middle}a${radius} ${radius} 0 0 1 0 ${radius * 2}H${middle}a${radius} ${radius} 0 0 1 0 ${-radius * 2}Z` }
    }
    case 'connector': {
      const radius = center - 1
      return { outline: `M${center} 1a${radius} ${radius} 0 1 1 0 ${radius * 2}a${radius} ${radius} 0 1 1 0 ${-radius * 2}Z` }
    }
    case 'decision':
      return { outline: `M${center} 1 ${right} ${middle} ${center} ${bottom} 1 ${middle}Z` }
    case 'inputOutput':
      return { outline: `M24 1H${right}L${width - 24} ${bottom}H1Z` }
    case 'document': {
      const base = height - 12
      return { outline: `M1 1H${right}V${base}C${width * .6} ${base - 33} ${width * .38} ${base + 34} 1 ${base}Z` }
    }
    case 'extract':
      return { outline: `M${center} 1 ${right} ${bottom}H1Z` }
    case 'subprocess':
      return { outline: `M1 1H${right}V${bottom}H1Z`, detail: `M16 1V${bottom}M${width - 16} 1V${bottom}` }
    default:
      return { outline: `M1 1H${right}V${bottom}H1Z` }
  }
}
