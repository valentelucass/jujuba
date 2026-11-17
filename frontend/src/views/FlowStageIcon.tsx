import { stageGeometry, type StageGeometry } from '../models/flowGeometry'
import type { NodeKind } from '../models/systemDiagram'

export function FlowOutline({ kind, geometry }: { kind: NodeKind; geometry: StageGeometry }) {
  const { width, height } = geometry
  const right = width - 1
  const bottom = height - 1
  const center = width / 2
  const middle = height / 2
  const outline = { className: 'flow-outline', vectorEffect: 'non-scaling-stroke' }
  switch (kind) {
    case 'start':
    case 'end':
      return <rect {...outline} x={1} y={1} width={width - 2} height={height - 2} rx={middle - 1} />
    case 'connector':
      return <circle {...outline} cx={center} cy={middle} r={center - 1} />
    case 'decision':
      return <path {...outline} d={`M${center} 1 ${right} ${middle} ${center} ${bottom} 1 ${middle}Z`} />
    case 'inputOutput':
      return <path {...outline} d={`M24 1H${right}L${width - 24} ${bottom}H1Z`} />
    case 'document': {
      const base = height - 12
      return <path {...outline} d={`M1 1H${right}V${base}C${width * .6} ${base - 33} ${width * .38} ${base + 34} 1 ${base}Z`} />
    }
    case 'extract':
      return <path {...outline} d={`M${center} 1 ${right} ${bottom}H1Z`} />
    case 'subprocess':
      return <>
        <rect {...outline} x={1} y={1} width={width - 2} height={height - 2} />
        <path className="flow-outline-detail" d={`M16 1V${bottom}M${width - 16} 1V${bottom}`} vectorEffect="non-scaling-stroke" />
      </>
    default:
      return <rect {...outline} x={1} y={1} width={width - 2} height={height - 2} />
  }
}

export function FlowStageIcon({ kind, size = 18 }: { kind: NodeKind; size?: number }) {
  const geometry = stageGeometry(kind)
  return <svg className={'flow-stage-icon flow-' + kind} width={size * 1.3} height={size}
    viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true">
    <FlowOutline kind={kind} geometry={geometry} />
  </svg>
}
