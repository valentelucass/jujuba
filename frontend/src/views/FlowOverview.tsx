import { ChevronDown, Info } from 'lucide-react'
import type { SystemDiagram } from '../models/systemDiagram'

export function FlowOverview({ diagram }: { diagram: SystemDiagram }) {
  const { summary, requirements, openQuestions } = diagram
  const hasSummary = !!summary.trim()
  if (!hasSummary && !requirements.length && !openQuestions.length) return null

  return <details className="flow-overview">
    <summary>
      <Info size={16} />
      <span>Informações do sistema</span>
      {hasSummary && <span className="flow-overview-excerpt">{summary}</span>}
      {!!requirements.length && <span className="flow-overview-count">{requirements.length} {requirements.length === 1 ? 'requisito' : 'requisitos'}</span>}
      {!!openQuestions.length && <span className="flow-overview-count">{openQuestions.length} {openQuestions.length === 1 ? 'questão em aberto' : 'questões em aberto'}</span>}
      <ChevronDown size={15} />
    </summary>
    <div className="flow-overview-content">
      {hasSummary && <section><h2>Resumo</h2><p>{summary}</p></section>}
      {!!requirements.length && <section><h2>Requisitos</h2><ul>{requirements.map((entry, index) => <li key={index}>{entry}</li>)}</ul></section>}
      {!!openQuestions.length && <section><h2>Questões em aberto</h2><ul>{openQuestions.map((entry, index) => <li key={index}>{entry}</li>)}</ul></section>}
    </div>
  </details>
}
