import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow, ViewportPortal, useNodesInitialized, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps, type ReactFlowInstance,
} from '@xyflow/react'
import { MousePointer2, Workflow } from 'lucide-react'
import { FlowOutline } from './FlowStageIcon'
import { arrangeStages, NOTE_WIDTH, type StageGeometry } from '../models/flowGeometry'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { MAX_FLOW_NOTE_TEXT, nodeKinds, type NodeKind, type StagePosition, type SystemDiagram, type SystemEdge } from '../models/systemDiagram'

import { useTheme } from './Theme'

type FlowNode = Node<{ label: string; kind: NodeKind | 'note'; geometry: StageGeometry; rename?: (id: string, label: string) => void }, 'flowStep'>
const nodeTypes = { flowStep: FlowStep }

function FlowStep({ id, data, selected }: NodeProps<FlowNode>) {
  const { kind, label, geometry, rename } = data
  const [draft, setDraft] = useState<string | null>(null)
  const initial = useRef(label)
  const { width, height, labelWidth, labelY } = geometry
  const editing = draft !== null && !!rename
  function finish(save: boolean) {
    if (save && draft !== null && draft !== initial.current) rename?.(id, draft)
    setDraft(null)
  }
  function start(event: MouseEvent) {
    if (!rename || editing || (event.target instanceof Element && event.target.closest('.react-flow__handle'))) return
    event.stopPropagation()
    initial.current = label
    setDraft(label)
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    event.stopPropagation()
    if (event.nativeEvent.isComposing || (kind === 'note' && event.key === 'Enter' && event.shiftKey)) return
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault()
      finish(event.key === 'Enter')
    }
  }
  if (kind === 'note') return <div className={'flow-note' + (selected ? ' selected' : '')} onDoubleClick={start}>
    {editing ? <textarea className="flow-inline-note nodrag nopan" aria-label="Texto da nota no canvas"
      autoFocus maxLength={MAX_FLOW_NOTE_TEXT} value={draft} onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)} onBlur={() => finish(true)} onKeyDown={keyDown} /> :
      <p className={label.trim() ? undefined : 'flow-note-empty'}>{label.trim() ? label : 'Escreva uma nota'}</p>}
  </div>

  return <div className={'flow-node flow-' + kind + (selected ? ' selected' : '')}
    style={{ width, height }} title={label || nodeKinds[kind]} onDoubleClick={start}>
    <svg className="flow-node-geometry" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <FlowOutline kind={kind} geometry={geometry} />
    </svg>
    {data.kind !== 'start' && <Handle type="target" position={Position.Top} />}
    <div className={`flow-node-label${editing ? ' is-editing' : ''}`} style={{ width: labelWidth, top: labelY }}>
      <small>{nodeKinds[kind]}</small>
      {editing ? <input className="flow-inline-label nodrag nopan" aria-label="Texto da forma"
        autoFocus maxLength={140} value={draft} onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)} onBlur={() => finish(true)}
        onKeyDown={keyDown} /> : <strong className="flow-stage-title">{label || 'Sem nome'}</strong>}
    </div>
    {data.kind !== 'end' && <Handle type="source" position={Position.Bottom} />}
  </div>
}

function arrange(diagram: SystemDiagram, rename: FlowNode['data']['rename']): FlowNode[] {
  const stages: FlowNode[] = arrangeStages(diagram).map(({ node: { id, kind, label }, position, geometry }) => ({
    id, type: 'flowStep', position,
    data: { label, kind, geometry, rename }, ariaLabel: nodeKinds[kind] + ' · ' + label,
  }))
  const notes = (diagram.notes ?? []).map<FlowNode>((note) => ({
    id: note.id, type: 'flowStep', position: note.position, connectable: false,
    data: { label: note.text, kind: 'note', rename, geometry: { width: NOTE_WIDTH, height: 0, labelWidth: NOTE_WIDTH, labelY: 0 } },
    ariaLabel: 'Nota' + (note.text ? ' · ' + note.text : ''),
  }))
  return [...stages, ...notes]
}

function FitNewStages({ nodeIds }: { nodeIds: string }) {
  const ready = useNodesInitialized()
  const flow = useReactFlow()
  const fitted = useRef('')

  useEffect(() => {
    if (ready && nodeIds && fitted.current !== nodeIds) {
      fitted.current = nodeIds
      void flow.fitView({ padding: .18, maxZoom: 1.25 })
    }
  }, [flow, nodeIds, ready])
  return null
}

export function SystemFlowCanvas({ diagram, selected, choose, connect, move, rename, disabled, peerCursor, sendCursor }: {
  diagram: SystemDiagram | null
  selected: string | null
  choose: (id: string | null) => void
  connect: (edge: SystemEdge) => void
  move: (id: string, position: StagePosition) => void
  rename: (id: string, label: string) => void
  disabled: boolean
  peerCursor: (StagePosition & { name: string }) | null
  sendCursor?: (position: StagePosition | null) => void
}) {
  const flow = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null)
  const lastCursor = useRef(0)
  const renameCurrent = useRef(rename)
  renameCurrent.current = rename
  const { theme } = useTheme()
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([])
  useEffect(() => {
    setNodes((previous) => {
      if (!diagram) return []
      return arrange(diagram, disabled ? undefined : (id, label) => renameCurrent.current(id, label))
        .map((node) => {
          const existing = previous.find((stage) => stage.id === node.id)
          return {
            ...node,
            measured: existing?.measured,
            ...(existing?.dragging && { position: existing.position, dragging: true }),
            selected: node.id === selected,
          }
        })
    })
  }, [diagram, selected, disabled, setNodes])
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

  const elementIds = [...(diagram?.nodes ?? []), ...(diagram?.notes ?? [])].map(({ id }) => id).join(',')

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
      minZoom={.12} zoomOnDoubleClick={false} nodeClickDistance={3} nodesDraggable={!disabled} nodesConnectable={!disabled} edgesReconnectable={false} deleteKeyCode={null}
      multiSelectionKeyCode={null} nodeExtent={[[-100_000, -100_000], [100_000, 100_000]]}
      onNodeDragStop={(_, node) => move(node.id, node.position)}
      onNodeClick={(_, node) => choose(node.id)} onPaneClick={() => choose(null)} onConnect={add}>
      <FitNewStages nodeIds={elementIds} />
      <Background id="system-flow-dots" gap={20} size={1.4} color="var(--canvas-dot)" />
      {peerCursor && <ViewportPortal>
        <div className="flow-peer-cursor" style={{ left: peerCursor.x, top: peerCursor.y }}
          aria-label={'Cursor de ' + peerCursor.name}>
          <MousePointer2 size={19} fill="currentColor" />
          <span>{peerCursor.name}</span>
        </div>
      </ViewportPortal>}
      {elementIds && <Controls showInteractive={false} />}
    </ReactFlow>
    {!elementIds && <div className="system-flow-empty">
      <span><Workflow size={28} /></span>
      <h2>Seu fluxo começa aqui</h2>
      <p>Adicione uma forma ou uma nota pelo painel direito.</p>
    </div>}
  </section>
}
