import { stageGeometry, stageOutline, type StageGeometry } from '../models/flowGeometry'
import type { NodeKind } from '../models/systemDiagram'

export function FlowOutline({ kind, geometry }: { kind: NodeKind; geometry: StageGeometry }) {
  const { outline, detail } = stageOutline(kind, geometry)
  return <>
    <path className="flow-outline" d={outline} vectorEffect="non-scaling-stroke" />
    {detail && <path className="flow-outline-detail" d={detail} vectorEffect="non-scaling-stroke" />}
  </>
}

export function FlowStageIcon({ kind, size = 18 }: { kind: NodeKind; size?: number }) {
  const geometry = stageGeometry(kind)
  return <svg className={'flow-stage-icon flow-' + kind} width={size * 1.3} height={size}
    viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true">
    <FlowOutline kind={kind} geometry={geometry} />
  </svg>
}
