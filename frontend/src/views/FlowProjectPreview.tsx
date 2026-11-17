
import { Workflow } from 'lucide-react'
import { arrangeStages, NOTE_WIDTH, noteHeight, type FlowPreview } from '../models/flowGeometry'
import { routeFlowEdges } from '../models/flowRoutes'
import { nodeKinds } from '../models/systemDiagram'
import { FlowOutline } from './FlowStageIcon'

export function FlowProjectPreview({ preview }: { preview: FlowPreview }) {
  const notes = preview.notes ?? []
  if (!preview.nodes.length && !notes.length) return <span className="flow-card-empty"><Workflow size={28} />Projeto vazio</span>
  const layout = arrangeStages(preview)
  const boxes = layout.map(({ node, position, geometry }) => ({ id: node.id, kind: node.kind, ...position, ...geometry }))
  const routes = routeFlowEdges(preview.edges, boxes)
  const values = [
    ...boxes,
    ...notes.map(({ position, text }) => ({ ...position, width: NOTE_WIDTH, height: noteHeight(text) })),
    ...routes.flatMap((route) => route.points.map((point) => ({ ...point, width: 0, height: 0 }))),
  ]
  const left = Math.min(...values.map(({ x }) => x)) - 30
  const top = Math.min(...values.map(({ y }) => y)) - 28
  const right = Math.max(...values.map(({ x, width }) => x + width)) + 30
  const bottom = Math.max(...values.map(({ y, height }) => y + height)) + 28
  return <svg className="flow-card-diagram" aria-hidden="true" viewBox={`${left} ${top} ${right - left} ${bottom - top}`}>
    {routes.map(({ id, path, returning }) => <path key={id} className="flow-card-edge"
      vectorEffect="non-scaling-stroke" d={path} strokeDasharray={returning ? '3 2' : undefined} />)}
    {layout.map(({ node: { id, kind, label }, position: { x, y }, geometry }) => {
      const { width, labelWidth, labelY } = geometry
      return <g key={id} className={'flow-' + kind} transform={`translate(${x} ${y})`}>
        <FlowOutline kind={kind} geometry={geometry} />
        <foreignObject x={(width - labelWidth) / 2} y={labelY - 24} width={labelWidth} height={48}>
          <div className="flow-card-node-label"><strong className="flow-stage-title">{label || nodeKinds[kind]}</strong></div>
        </foreignObject>
      </g>
    })}
    {notes.map(({ id, position, text }) => <foreignObject key={id} x={position.x} y={position.y}
      width={NOTE_WIDTH} height={noteHeight(text)}>
      <div className="flow-card-note">{text.trim() || 'Nota'}</div>
    </foreignObject>)}
  </svg>
}
