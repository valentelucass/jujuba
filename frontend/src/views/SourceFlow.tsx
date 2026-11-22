import { useMemo, useState } from 'react'
import { ArrowLeft, ChevronRight, GitBranch } from 'lucide-react'
import type { SourceArea, SourceView } from '../models/flowWorkspace'
import { SystemFlowCanvas } from './SystemFlowCanvas'
import './sourceFlow.css'

function operations(area: SourceArea) {
  return area.flow?.nodes.filter((n) => n.kind !== 'start' && n.kind !== 'end') ?? []
}

function stepCount(area: SourceArea) {
  const count = operations(area).length
  return count === 1 ? '1 etapa' : count + ' etapas'
}

export function SourceFlow({ source }: { source: SourceView }) {
  const [active, setActive] = useState<string | null>(null)
  const [selected, select] = useState<string | null>(null)
  const overview = source.answer
  const area = overview?.areas.find((a) => a.title === active && a.flow)
  const diagram = useMemo(() => area?.flow && overview
    ? { ...overview, title: area.title, nodes: area.flow.nodes, edges: area.flow.edges, notes: [] }
    : overview, [overview, area])
  const step = diagram?.nodes.find((n) => n.id === selected)
  const reference = step && area?.flow?.references[step.id]
  const alternatives = area && step?.kind === 'decision' ? area.flow?.edges.filter((e) => e.from === step.id) ?? [] : []
  const related = step && !area ? overview?.areas.filter((a) => a.flow && a.entry === step.id) ?? [] : []
  const total = overview?.areas.reduce((count, a) => count + operations(a).length, 0) ?? 0
  function navigate(title: string | null) {
    setActive(title)
    const destination = overview?.areas.find((a) => a.title === title)
    select(destination ? operations(destination)[0]?.id ?? null : null)
  }
  return <>
    <div className="source-sync" role="status">
      <span>{source.status.message}</span>
      {source.updatedAt && <small>Última leitura em {new Date(source.updatedAt).toLocaleString('pt-BR')}</small>}
    </div>
    {overview && diagram && <>
      {!!total && <nav className="source-breadcrumb" aria-label="Navegação do fluxograma">
        {area ? <><button type="button" className="button" onClick={() => navigate(null)}><ArrowLeft size={14}/>Visão geral</button>
          <ChevronRight size={14}/><strong>{area.title}</strong></> : <strong>Visão geral</strong>}
        <small>{area ? stepCount(area) + ' neste processo' : overview.areas.length + ' processos · ' + total + ' etapas detalhadas'}</small>
      </nav>}
      <div className="source-layout">
        <SystemFlowCanvas key={'canvas-' + (area?.title ?? '')} diagram={diagram} selected={selected} choose={select}
          disabled focusSelection={!!area} connect={() => {}} move={() => {}} rename={() => {}} peerCursors={[]} />
        <aside className="system-design-panel source-reader" key={'reader-' + (area?.title ?? '')}>
          {step && <section className="source-step"><h2>{step.label}</h2><p>{step.detail}</p>
            {alternatives.length > 0 && <ul className="source-choices" aria-label="Caminhos desta decisão">
              {alternatives.map((e, i) => <li key={i}><button type="button" aria-label={'Seguir caminho ' + e.label} onClick={() => select(e.to)}>
                <strong>{e.label}</strong><span>{e.to === step.id ? 'Repetir esta etapa' : diagram.nodes.find((n) => n.id === e.to)?.label}</span>
              </button></li>)}
            </ul>}
            {reference && <><small>Arquivo desta etapa</small><code>{reference}</code></>}
            {related.map((a) => <button key={a.title} type="button" className="button" onClick={() => navigate(a.title)}>Abrir {a.title}<ChevronRight size={14}/></button>)}
          </section>}
          {area && <section><h2>Etapas do processo</h2><ol className="source-operations">
            {operations(area).map((n) => <li key={n.id}><button type="button" aria-pressed={selected === n.id} onClick={() => select(n.id)}>{n.label}</button></li>)}
          </ol></section>}
          <h2>Telas e processos</h2>
          {overview.areas.map((a) => a.flow ? <button type="button" className="source-process"
            key={a.title} aria-label={'Abrir processo ' + a.title} aria-pressed={a.title === area?.title} onClick={() => navigate(a.title)}>
            <GitBranch size={15}/><span><strong>{a.title}</strong><small>{stepCount(a)}</small></span><ChevronRight size={15}/>
          </button> : <details key={a.title}><summary>{a.title}</summary><ol>
            {a.steps.map((s, j) => <li key={j}>{s}</li>)}</ol><small>Arquivos consultados</small>
            {a.files.map((f) => <code key={f}>{f}</code>)}</details>)}
        </aside>
      </div>
    </>}
  </>
}
