import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow, ViewportPortal, useNodesInitialized, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps, type ReactFlowInstance,
} from '@xyflow/react'
import { MousePointer2, Workflow } from 'lucide-react'
import { FlowOutline } from './FlowStageIcon'
import { arrangeStages, type StageGeometry } from '../models/flowGeometry'
import { useEffect, useMemo, useRef } from 'react'
import { nodeKinds, type NodeKind, type StagePosition, type SystemDiagram, type SystemEdge } from '../models/systemDiagram'

import { useTheme } from './Theme'

type FlowNode = Node<{ label: string; kind: NodeKind; geometry: StageGeometry }, 'flowStep'>
const nodeTypes = { flowStep: FlowStep }

function FlowStep({ data, selected }: NodeProps<FlowNode>) {
  const { kind, label, geometry } = data
  const { width, height, labelWidth, labelY } = geometry
  return <div className={'flow-node flow-' + data.kind + (selected ? ' selected' : '')}
    style={{ width, height }} title={data.label || nodeKinds[data.kind]}>
    <svg className="flow-node-geometry" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <FlowOutline kind={kind} geometry={geometry} />
    </svg>
    {data.kind !== 'start' && <Handle type="target" position={Position.Top} />}
    <div className="flow-node-label" style={{ width: labelWidth, top: labelY }}>
      <small>{nodeKinds[kind]}</small>
      <strong className="flow-stage-title">{label || 'Sem nome'}</strong>
    </div>
    {data.kind !== 'end' && <Handle type="source" position={Position.Bottom} />}
  </div>
}

function arrange(diagram: SystemDiagram): FlowNode[] {
  return arrangeStages(diagram).map(({ node: { id, kind, label }, position, geometry }) => ({
    id, type: 'flowStep', position,
    data: { label, kind, geometry }, ariaLabel: nodeKinds[kind] + ' · ' + label,
  }))
}

function FitNewStages({ nodeIds }: { nodeIds: string }) {
  const ready = useNodesInitialized()
  const flow = useReactFlow()

  useEffect(() => {
    if (ready && nodeIds) void flow.fitView({ padding: .18, maxZoom: 1.25 })
  }, [flow, nodeIds, ready])
  return null
}

export function SystemFlowCanvas({ diagram, selected, choose, connect, move, disabled, peerCursor, sendCursor }: {
  diagram: SystemDiagram | null
  selected: string | null
  choose: (id: string | null) => void
  connect: (edge: SystemEdge) => void
  move: (id: string, position: StagePosition) => void
  disabled: boolean
  peerCursor: (StagePosition & { name: string }) | null
  sendCursor?: (position: StagePosition | null) => void
}) {
  const flow = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null)
  const lastCursor = useRef(0)
  const { theme } = useTheme()
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([])
  useEffect(() => {
    setNodes(diagram ? arrange(diagram).map((node) => ({ ...node, selected: node.id === selected })) : [])
  }, [diagram, selected, setNodes])
  const edges = useMemo<Edge[]>(() => (diagram?.edges ?? []).map((edge, index) => ({
    id: 'edge-' + index,
    source: edge.from,
    target: edge.to,
    type: 'smoothstep',
    label: edge.label || undefined,
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--gold-line)' },
    style: { stroke: 'var(--gold-line)', strokeWidth: 1.7 },
    labelStyle: { fill: 'var(--gold)', fontWeight: 600 },
    labelBgStyle: { fill: 'var(--surface)', fillOpacity: 1 },
  })), [diagram])

  function add(edge: Connection) {
    if (edge.source && edge.target && edge.source !== edge.target) {
      connect({ from: edge.source, to: edge.target, label: '' })
    }
  }

  return <section className="system-flow-canvas" aria-label="Fluxograma do sistema"
    onPointerMove={(event) => {
      const now = performance.now()
      if (!sendCursor || !flow.current || now - lastCursor.current < 60) return
      lastCursor.current = now
      sendCursor(flow.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
    }}
    onPointerLeave={() => { lastCursor.current = 0; sendCursor?.(null) }}>
    <ReactFlow onInit={(api) => { flow.current = api }} nodes={nodes} edges={edges} onNodesChange={onNodesChange}
      nodeTypes={nodeTypes} colorMode={theme} fitView fitViewOptions={{ padding: .18, maxZoom: 1.25 }}
      minZoom={.12} nodesDraggable={!disabled} nodesConnectable={!disabled} edgesReconnectable={false} deleteKeyCode={null}
      multiSelectionKeyCode={null} nodeExtent={[[-100_000, -100_000], [100_000, 100_000]]}
      onNodeDragStop={(_, node) => move(node.id, node.position)}
      onNodeClick={(_, node) => choose(node.id)} onPaneClick={() => choose(null)} onConnect={add}>
      <FitNewStages nodeIds={diagram?.nodes.map((node) => node.id).join(',') ?? ''} />
      <Background id="system-flow-dots" gap={20} size={1.4} color="var(--canvas-dot)" />
      {peerCursor && <ViewportPortal>
        <div className="flow-peer-cursor" style={{ left: peerCursor.x, top: peerCursor.y }}
          aria-label={'Cursor de ' + peerCursor.name}>
          <MousePointer2 size={19} fill="currentColor" />
          <span>{peerCursor.name}</span>
        </div>
      </ViewportPortal>}
      {!!diagram?.nodes.length && <Controls showInteractive={false} />}
    </ReactFlow>
    {!diagram?.nodes.length && <div className="system-flow-empty">
      <span><Workflow size={28} /></span>
      <h2>Seu fluxo começa aqui</h2>
      <p>Adicione uma forma pelo painel direito para começar.</p>
    </div>}
  </section>
}
