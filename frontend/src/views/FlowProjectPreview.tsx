
import { Workflow } from 'lucide-react'
import { arrangeStages, stageGeometry, type FlowPreview } from '../models/flowGeometry'
import { nodeKinds } from '../models/systemDiagram'
import { FlowOutline } from './FlowStageIcon'

export function FlowProjectPreview({ preview }: { preview: FlowPreview }) {
  if (!preview.nodes.length) return <span className="flow-card-empty"><Workflow size={28} />Sem etapas</span>
  const positions = arrangeStages(preview)
  const boxes = new Map(preview.nodes.map((node) => [
    node.id, { ...positions.get(node.id)!, ...stageGeometry[node.kind] },
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
      const y = source.y + source.height
      const endX = target.x + target.width / 2
      const mid = (y + target.y) / 2
      return <path key={index} className="flow-card-edge" vectorEffect="non-scaling-stroke"
        d={`M${x} ${y}V${mid}H${endX}V${target.y}`} />
    })}
    {preview.nodes.map(({ id, kind, label }) => {
      const { x, y, width, height } = boxes.get(id)!
      const title = label || nodeKinds[kind]
      const limit = kind === 'connector' ? 10 : 21
      return <g key={id} className={'flow-' + kind} transform={`translate(${x} ${y})`}>
        <FlowOutline kind={kind} />
        <text x={width / 2} y={height * (kind === 'extract' ? .72 : kind === 'document' ? .42 : .5)}
          textAnchor="middle" dominantBaseline="middle">
          {title.length > limit ? title.slice(0, limit - 1) + '…' : title}
        </text>
      </g>
    })}
  </svg>
}
