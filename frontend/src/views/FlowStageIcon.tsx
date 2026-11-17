
import { stageGeometry } from '../models/flowGeometry'
import type { NodeKind } from '../models/systemDiagram'

export function FlowOutline({ kind }: { kind: NodeKind }) {
  const { outline, detail } = stageGeometry[kind]
  return <>
    <path className="flow-outline" d={outline} vectorEffect="non-scaling-stroke" />
    {detail && <path className="flow-outline-detail" d={detail} vectorEffect="non-scaling-stroke" />}
  </>
}

export function FlowStageIcon({ kind, size = 18 }: { kind: NodeKind; size?: number }) {
  const { width, height } = stageGeometry[kind]
  return <svg className={'flow-stage-icon flow-' + kind} width={size * 1.3} height={size} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    <FlowOutline kind={kind} />
  </svg>
}
