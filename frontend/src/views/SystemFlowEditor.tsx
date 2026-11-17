import { ChevronRight, Info, Link2, ListTree, Trash2 } from 'lucide-react'
import { FlowStageIcon } from './FlowStageIcon'
import { useState, type FormEvent } from 'react'
import { nodeKinds, type NodeKind, type SystemDiagram, type SystemEdge, type SystemNode } from '../models/systemDiagram'

export function SystemFlowEditor({ diagram, selected, select, update, addEdge, disabled }: {
  diagram: SystemDiagram
  selected: string | null
  select: (id: string | null) => void
  update: (next: SystemDiagram) => void
  addEdge: (edge: SystemEdge) => void
  disabled: boolean
}) {
  const node = diagram.nodes.find((entry) => entry.id === selected)
  const hasStart = diagram.nodes.some((entry) => entry.kind === 'start')

  function patchNode(change: Partial<SystemNode>) {
    if (!node) return
    update({ ...diagram, nodes: diagram.nodes.map((entry) => entry.id === node.id ? { ...entry, ...change } : entry) })
  }

  function createStep(kind: NodeKind) {
    const id = 'step-' + crypto.randomUUID().slice(0, 12)
    update({ ...diagram, nodes: [...diagram.nodes, { id, label: nodeKinds[kind], detail: '', kind }] })
    select(id)
  }

  function removeStep() {
    if (!node) return
    update({ ...diagram, nodes: diagram.nodes.filter((entry) => entry.id !== node.id),
      edges: diagram.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id) })
    select(null)
  }

  return <fieldset className="system-form" disabled={disabled}>
    <h2>Formas</h2>
    <div className="flow-palette" role="group" aria-label="Adicionar forma">
      {(Object.entries(nodeKinds) as [NodeKind, string][]).map(([kind, label]) =>
        <button key={kind} type="button" className={'button flow-tool flow-tool-' + kind}
          disabled={diagram.nodes.length >= 24 || (kind === 'start' && hasStart)}
          onClick={() => createStep(kind)}><FlowStageIcon kind={kind} size={25} /><span>{label}</span></button>)}
    </div>
    <details className="flow-inspector-section">
      <summary><Info size={15} />Informações do sistema<ChevronRight size={13} /></summary>
      <label>Título<input value={diagram.title} maxLength={120} onChange={(event) => update({ ...diagram, title: event.target.value })} /></label>
      <label>Resumo<textarea value={diagram.summary} maxLength={2400} rows={3}
        onChange={(event) => update({ ...diagram, summary: event.target.value })} /></label>
      <LineList title="Requisitos" values={diagram.requirements} change={(requirements) => update({ ...diagram, requirements })} />
      <LineList title="Questões em aberto" values={diagram.openQuestions} change={(openQuestions) => update({ ...diagram, openQuestions })} />
    </details>
    <details className="flow-inspector-section" open>
      <summary><ListTree size={15} />Etapas <span className="flow-stage-count">{diagram.nodes.length}</span><ChevronRight size={13} /></summary>
      {diagram.nodes.length ? <div className="flow-stage-list" aria-label="Editar etapa">
        {diagram.nodes.map((entry) => <button key={entry.id} type="button" className="button"
          aria-pressed={selected === entry.id} onClick={() => select(selected === entry.id ? null : entry.id)}>
          <FlowStageIcon kind={entry.kind} /><span>{entry.label || 'Sem nome'}</span>
        </button>)}
      </div> : <small className="system-hint">Adicione uma forma para criar a primeira etapa.</small>}
    </details>
    {node && <div className="stage-fields">
      <label>Nome<input value={node.label} maxLength={140} onChange={(event) => patchNode({ label: event.target.value })} /></label>
      <label>Tipo<select value={node.kind} onChange={(event) => patchNode({ kind: event.target.value as NodeKind })}>
        {Object.entries(nodeKinds).map(([kind, name]) => <option key={kind} value={kind}
          disabled={kind === 'start' && hasStart && node.kind !== 'start'}>{name}</option>)}
      </select></label>
      <label>Regra ou comportamento<textarea value={node.detail} maxLength={900} rows={3}
        onChange={(event) => patchNode({ detail: event.target.value })} /></label>
      <button type="button" className="button system-remove" onClick={removeStep}><Trash2 size={14} />Remover etapa</button>
    </div>}
    <details className="flow-inspector-section" open={diagram.nodes.length >= 2 && !node ? true : undefined}>
      <summary><Link2 size={15} />Conexões<ChevronRight size={13} /></summary>
      <ConnectionEditor key={selected ?? ''} diagram={diagram} selected={selected} add={addEdge} />
      <div className="system-edge-list">
        {diagram.edges.map((edge, index) => {
          if (selected && selected !== edge.from && selected !== edge.to) return null
          const from = diagram.nodes.find((entry) => entry.id === edge.from)?.label ?? edge.from
          const to = diagram.nodes.find((entry) => entry.id === edge.to)?.label ?? edge.to
          return <div key={index}>
            <small>{from} → {to}</small>
            <div className="system-field-row">
              <input aria-label={'Rótulo de ' + from + ' para ' + to} placeholder="Rótulo da saída" value={edge.label} maxLength={120}
                onChange={(event) => update({ ...diagram, edges: diagram.edges.map((entry, i) =>
                  i === index ? { ...entry, label: event.target.value } : entry) })} />
              <button type="button" className="icon-button" aria-label={'Remover conexão de ' + from + ' para ' + to}
                onClick={() => update({ ...diagram, edges: diagram.edges.filter((_, i) => i !== index) })}><Trash2 size={14} /></button>
            </div>
          </div>
        })}
      </div>
    </details>
  </fieldset>
}

function LineList({ title, values, change }: { title: string; values: string[]; change: (values: string[]) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return <label>{title}<textarea value={draft ?? values.join('\n')} rows={3} maxLength={4000}
    placeholder="Uma por linha" onChange={(event) => {
      setDraft(event.target.value)
      change(event.target.value.split('\n').map((line) => line.trim()).filter(Boolean))
    }} onBlur={() => setDraft(null)} /></label>
}

function ConnectionEditor({ diagram, selected, add }: { diagram: SystemDiagram; selected: string | null; add: (edge: SystemEdge) => void }) {
  const origins = diagram.nodes.filter((node) => node.kind !== 'end')
  const [from, setFrom] = useState(selected && origins.some((node) => node.id === selected) ? selected : origins[0]?.id ?? '')
  const [to, setTo] = useState('')
  const [label, setLabel] = useState('')
  const source = origins.some((node) => node.id === from) ? from : origins[0]?.id ?? ''
  const children = diagram.nodes.filter((node) => node.kind !== 'start' && node.id !== source)
  const target = children.some((node) => node.id === to) ? to : children[0]?.id ?? ''

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!source || !target || source === target) return
    add({ from: source, to: target, label: label.trim() })
    setLabel('')
  }

  return <form className="system-form system-connections" onSubmit={submit}>
    <label>Origem<select disabled={!origins.length} value={source} onChange={(event) => setFrom(event.target.value)}>
      {origins.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
    </select></label>
    <label>Destino<select disabled={!children.length} value={target} onChange={(event) => setTo(event.target.value)}>
      {children.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
    </select></label>
    <label>Nome da saída<input value={label} maxLength={120} placeholder="Ex. Sim"
      onChange={(event) => setLabel(event.target.value)} /></label>
    <button type="submit" className="button" disabled={!source || !target || source === target || diagram.edges.length >= 48}>
      <Link2 size={14} />Adicionar conexão
    </button>
  </form>
}
