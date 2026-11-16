import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow, useNodesState,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react'
import { CircleCheck, CirclePlay, GitBranch, Workflow } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { nodeKinds, type NodeKind, type StagePosition, type SystemDiagram, type SystemEdge } from '../models/systemDiagram'

import { useTheme } from './Theme'

type FlowNode = Node<{ label: string; kind: NodeKind }, 'flowStep'>
const nodeTypes = { flowStep: FlowStep }
const glyphs = { start: CirclePlay, action: Workflow, decision: GitBranch, end: CircleCheck }

function FlowStep({ data, selected }: NodeProps<FlowNode>) {
  const Icon = glyphs[data.kind]
  return <div className={'flow-node flow-' + data.kind + (selected ? ' selected' : '')}>
    {data.kind !== 'start' && <Handle type="target" position={Position.Top} />}
    <small><Icon size={13} />{nodeKinds[data.kind]}</small>
    <strong>{data.label || 'Sem nome'}</strong>
    {data.kind !== 'end' && <Handle type="source" position={Position.Bottom} />}
  </div>
}

function arrange(diagram: SystemDiagram): FlowNode[] {
  const start = diagram.nodes.find((node) => node.kind === 'start')?.id
  const distance = new Map<string, number>()
  if (start) {
    const pending = [start]
    distance.set(start, 0)
    for (let i = 0; i < pending.length; i++) {
      const id = pending[i]
      for (const edge of diagram.edges) {
        if (edge.from === id && !distance.has(edge.to)) {
          distance.set(edge.to, distance.get(id)! + 1)
          pending.push(edge.to)
        }
      }
    }
  }
  const later = Math.max(-1, ...distance.values()) + 1
  const rows = new Map<number, string[]>()
  for (const node of diagram.nodes) {
    const row = distance.get(node.id) ?? later
    rows.set(row, [...(rows.get(row) ?? []), node.id])
  }
  return diagram.nodes.map((node) => {
    const y = distance.get(node.id) ?? later
    const row = rows.get(y)!
    return {
      id: node.id, type: 'flowStep', position: node.position ?? { x: (row.indexOf(node.id) - (row.length - 1) / 2) * 244, y: y * 116 },
      data: { label: node.label, kind: node.kind },
      ariaLabel: nodeKinds[node.kind] + ' · ' + node.label,
    }
  })
}

export function SystemFlowCanvas({ diagram, selected, choose, connect, move, disabled, openAssistant }: {
  diagram: SystemDiagram | null
  selected: string | null
  choose: (id: string | null) => void
  connect: (edge: SystemEdge) => void
  move: (id: string, position: StagePosition) => void
  disabled: boolean
  openAssistant: () => void
}) {
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

  return <section className="system-flow-canvas" aria-label="Fluxograma do sistema">
    {diagram ? <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange}
      nodeTypes={nodeTypes} colorMode={theme} fitView fitViewOptions={{ padding: .18, maxZoom: 1.25 }}
      minZoom={.12} nodesDraggable={!disabled} nodesConnectable={!disabled} edgesReconnectable={false} deleteKeyCode={null}
      multiSelectionKeyCode={null} nodeExtent={[[-100_000, -100_000], [100_000, 100_000]]}
      onNodeDragStop={(_, node) => move(node.id, node.position)}
      onNodeClick={(_, node) => choose(node.id)} onPaneClick={() => choose(null)} onConnect={add}>
      <Background gap={21} size={1.2} color="var(--dot)" />
      <Controls showInteractive={false} />
    </ReactFlow> : <div className="system-flow-empty">
      <span><Workflow size={28} /></span>
      <h2>Seu fluxo começa aqui</h2>
      <p>Crie um fluxo manualmente ou descreva o sistema no chat.</p>
      <button className="button design-accent" onClick={openAssistant}>Abrir assistente</button>
    </div>}
  </section>
}
