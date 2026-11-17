
import { Workflow } from 'lucide-react'
import { arrangeStages, type FlowPreview } from '../models/flowGeometry'
import { nodeKinds } from '../models/systemDiagram'
import { FlowOutline } from './FlowStageIcon'

export function FlowProjectPreview({ preview }: { preview: FlowPreview }) {
  if (!preview.nodes.length) return <span className="flow-card-empty"><Workflow size={28} />Sem etapas</span>
  const layout = arrangeStages(preview)
  const boxes = new Map(layout.map(({ node, position, geometry }) => [
    node.id, { ...position, ...geometry, kind: node.kind },
  ]))
  const values = [...boxes.values()]
  const left = Math.min(...values.map(({ x }) => x)) - 30
  const top = Math.min(...values.map(({ y }) => y)) - 28
  const right = Math.max(...values.map(({ x, width }) => x + width)) + 30
  const bottom = Math.max(...values.map(({ y, height }) => y + height)) + 28
  return <svg className="flow-card-diagram" aria-hidden="true" viewBox={`${left} ${top} ${right - left} ${bottom - top}`}>
    {preview.edges.map(({ from, to }, index) => {
      const source = boxes.get(from)
      const target = boxes.get(to)
      if (!source || !target) return null
      const x = source.x + source.width / 2
      const y = source.y + source.height - (source.kind === 'document' ? 12 : 0)
      const endX = target.x + target.width / 2
      const mid = (y + target.y) / 2
      return <path key={index} className="flow-card-edge" vectorEffect="non-scaling-stroke"
        d={`M${x} ${y}V${mid}H${endX}V${target.y}`} />
    })}
    {layout.map(({ node: { id, kind, label }, position: { x, y }, geometry }) => {
      const { width, labelWidth, labelY } = geometry
      return <g key={id} className={'flow-' + kind} transform={`translate(${x} ${y})`}>
        <FlowOutline kind={kind} geometry={geometry} />
        <foreignObject x={(width - labelWidth) / 2} y={labelY - 24} width={labelWidth} height={48}>
          <div className="flow-card-node-label"><strong className="flow-stage-title">{label || nodeKinds[kind]}</strong></div>
        </foreignObject>
      </g>
    })}
  </svg>
}
