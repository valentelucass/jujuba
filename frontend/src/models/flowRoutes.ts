import type { NodeKind, StagePosition, SystemEdge } from './systemDiagram'

type Side = 'left' | 'right' | 'top' | 'bottom'
export type FlowBox = StagePosition & { id: string; kind: NodeKind; width: number; height: number }
export type FlowRoute = {
  edge: SystemEdge
  id: string
  points: StagePosition[]
  path: string
  label: StagePosition
  returning: boolean
}

const approach = 18
const clearance = 12
const radius = 7
const centerX = (box: FlowBox) => box.x + box.width / 2
const length = (a: StagePosition, b: StagePosition) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

function anchor(box: FlowBox, side: Side): StagePosition {
  if (side === 'top' || side === 'bottom') {
    return { x: centerX(box), y: box.y + (side === 'top' ? 0 : box.height - (box.kind === 'document' ? 12 : 0)) }
  }
  const inset = box.kind === 'inputOutput' ? 12 : box.kind === 'extract' ? box.width / 4 : 1
  return { x: box.x + (side === 'left' ? inset : box.width - inset), y: box.y + box.height / 2 }
}

function simplify(points: StagePosition[]) {
  const distinct: StagePosition[] = []
  for (const point of points) {
    const previous = distinct.at(-1)
    if (previous && length(previous, point) === 0) continue
    const earlier = distinct.at(-2)
    if (earlier && previous && length(earlier, previous) + length(previous, point) === length(earlier, point) &&
      ((earlier.x === point.x && point.x === previous.x) || (earlier.y === point.y && point.y === previous.y))) {
      distinct.pop()
    }
    distinct.push(point)
  }
  return distinct
}

function interpolation(from: StagePosition, to: StagePosition, distance: number): StagePosition {
  const ratio = distance / length(from, to)
  return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }
}

function roundedPath(points: StagePosition[]) {
  const coord = ({ x, y }: StagePosition) => `${x} ${y}`
  let path = 'M' + coord(points[0])
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]
    const point = points[index]
    const next = points[index + 1]
    const turn = Math.min(radius, length(previous, point) / 2, length(next, point) / 2)
    path += ' L' + coord(interpolation(point, previous, turn)) +
      ' Q' + coord(point) + ' ' + coord(interpolation(point, next, turn))
  }
  return path + ' L' + coord(points.at(-1)!)
}

type Segment = [StagePosition, StagePosition]
const segments = (points: StagePosition[]): Segment[] => points.slice(1).map((point, index) => [points[index], point])

function hitsBox([a, b]: Segment, box: FlowBox) {
  return Math.max(a.x, b.x) > box.x - clearance && Math.min(a.x, b.x) < box.x + box.width + clearance &&
    Math.max(a.y, b.y) > box.y - clearance && Math.min(a.y, b.y) < box.y + box.height + clearance
}

function interference([a, b]: Segment, [c, d]: Segment) {
  const vertical = a.x === b.x
  const otherVertical = c.x === d.x
  if (vertical !== otherVertical) {
    const [p, q, r, s] = vertical ? [a, b, c, d] : [c, d, a, b]
    return Math.min(r.x, s.x) < p.x && p.x < Math.max(r.x, s.x) &&
      Math.min(p.y, q.y) < r.y && r.y < Math.max(p.y, q.y) ? 80 : 0
  }
  if (vertical ? a.x !== c.x : a.y !== c.y) return 0
  const [p, q, r, s] = vertical ? [a.y, b.y, c.y, d.y] : [a.x, b.x, c.x, d.x]
  return Math.max(0, Math.min(Math.max(p, q), Math.max(r, s)) - Math.max(Math.min(p, q), Math.min(r, s))) * 2.4
}

function ranked(boxes: FlowBox[], edges: SystemEdge[]) {
  const targets = new Map(boxes.map(({ id }) => [id, [] as string[]]))
  for (const edge of edges) targets.get(edge.from)?.push(edge.to)
  const depth = new Map<string, number>()
  function walk(start: string, first: number) {
    const pending = [start]
    depth.set(start, first)
    for (const id of pending) {
      for (const to of targets.get(id) ?? []) {
        if (!depth.has(to)) {
          depth.set(to, depth.get(id)! + 1)
          pending.push(to)
        }
      }
    }
  }
  for (const box of [...boxes.filter((box) => box.kind === 'start'), ...boxes]) {
    if (!depth.has(box.id)) walk(box.id, 0)
  }
  function reaches(from: string, goal: string) {
    const visited = new Set([from])
    const pending = [from]
    for (const id of pending) {
      if (id === goal) return true
      for (const next of targets.get(id) ?? []) {
        if (!visited.has(next)) {
          visited.add(next)
          pending.push(next)
        }
      }
    }
    return false
  }
  return (edge: SystemEdge) => (depth.get(edge.from) ?? -1) >= (depth.get(edge.to) ?? 0) && reaches(edge.to, edge.from)
}

export function routeFlowEdges(edges: SystemEdge[], boxes: FlowBox[]): FlowRoute[] {
  const lookup = new Map(boxes.map((box) => [box.id, box]))
  const returning = ranked(boxes, edges)
  const occupied: Segment[] = []
  const routes: FlowRoute[] = []
  const ordered = edges.map((edge, index) => ({ edge, index, returning: returning(edge) }))
    .sort((a, b) => Number(a.returning) - Number(b.returning))
  for (const entry of ordered) {
    const { edge } = entry
    const source = lookup.get(edge.from)
    const target = lookup.get(edge.to)
    if (!source || !target) continue
    const obstacles = boxes.filter(({ id }) => id !== source.id && id !== target.id)
    const top = anchor(target, 'top')
    const bottom = anchor(source, 'bottom')
    const offset = centerX(target) - centerX(source)
    const toward = offset < 0 ? 'left' : 'right'
    const opposite = toward === 'left' ? 'right' : 'left'
    const sign = offset < 0 ? -1 : 1
    const fromSide = anchor(source, toward)
    const toSide = anchor(target, opposite)
    const candidates: { points: StagePosition[]; preference: number }[] = []

    if (!entry.returning && top.y > bottom.y + clearance) {
      for (const fraction of [.5, .32, .68]) {
        const y = bottom.y + (top.y - bottom.y) * fraction
        candidates.push({ points: [bottom, { x: bottom.x, y }, { x: top.x, y }, top], preference: source.kind === 'decision' && Math.abs(offset) > 55 ? 45 : 0 })
      }
    }
    if (!entry.returning && (toSide.x - fromSide.x) * sign > approach * 2) {
      const x = (fromSide.x + toSide.x) / 2
      candidates.push({ points: [fromSide, { x, y: fromSide.y }, { x, y: toSide.y }, toSide],
        preference: Math.abs(fromSide.y - toSide.y) < 72 ? 0 : 22 })
      if (top.y > fromSide.y + approach) {
        const y = top.y - approach
        candidates.push({ points: [fromSide, { x, y: fromSide.y }, { x, y }, { x: top.x, y }, top], preference: 0 })
      }
    }
    for (const side of ['left', 'right'] as const) {
      const from = anchor(source, side)
      const to = anchor(target, side)
      const band = boxes.filter(({ y, height }) => y <= Math.max(from.y, to.y) && y + height >= Math.min(from.y, to.y))
      const outer = side === 'left' ? Math.min(...band.map(({ x }) => x)) : Math.max(...band.map(({ x, width }) => x + width))
      const outward = side === 'left' ? -1 : 1
      for (const lane of [30, 48, 66]) {
        const x = outer + outward * lane
        candidates.push({ points: [from, { x, y: from.y }, { x, y: to.y }, to],
          preference: entry.returning ? 0 : 110 })
      }
    }

    let picked: StagePosition[] = []
    let lowest = Infinity
    for (const candidate of candidates) {
      const points = simplify(candidate.points)
      if (points.length < 2) continue
      const parts = segments(points)
      const score = parts.reduce((total, part) => total + length(...part) +
        obstacles.filter((box) => hitsBox(part, box)).length * 2400 +
        occupied.reduce((cost, prior) => cost + interference(part, prior), 0), candidate.preference)
      if (score < lowest) {
        lowest = score
        picked = points
      }
    }
    if (picked.length < 2) continue
    const parts = segments(picked)
    const [a, b] = [...parts].sort((p, q) => labelScore(q, entry.returning) - labelScore(p, entry.returning))[0]
    occupied.push(...parts)
    routes.push({
      edge, id: 'edge-' + entry.index, points: picked, path: roundedPath(picked), returning: entry.returning,
      label: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    })
  }
  return routes
}

function labelScore([a, b]: Segment, returning: boolean) {
  const preferred = returning ? a.x === b.x : a.y === b.y
  const distance = length(a, b)
  return preferred && distance >= 32 ? distance + 180 : distance
}
