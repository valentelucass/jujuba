import { useState } from 'react'
import './sourceFlow.css'
import type { SourceView } from '../models/flowWorkspace'
import { SystemFlowCanvas } from './SystemFlowCanvas'

export function SourceFlow({ source }: { source: SourceView }) {
  const [selected, select] = useState<string | null>(null)
  const diagram = source.answer
  const step = diagram?.nodes.find((n) => n.id === selected)
  return (
    <>
      <div className="source-sync" role="status">
        <span>{source.status.message}</span>
        {source.updatedAt && (
          <small>
            Última leitura em{' '}
            {new Date(source.updatedAt).toLocaleString('pt-BR')}
          </small>
        )}
      </div>
      {diagram && (
        <div className="source-layout">
          <SystemFlowCanvas
            diagram={diagram}
            selected={selected}
            choose={select}
            disabled
            connect={() => {}}
            move={() => {}}
            rename={() => {}}
            peerCursors={[]}
          />
          <aside className="system-design-panel source-reader">
            {step && (
              <section>
                <h2>{step.label}</h2>
                <p>{step.detail}</p>
              </section>
            )}
            <h2>Telas e processos</h2>
            {diagram.areas.map((area, i) => (
              <details key={i}>
                <summary>{area.title}</summary>
                <ol>
                  {area.steps.map((s, j) => (
                    <li key={j}>{s}</li>
                  ))}
                </ol>
                <small>Arquivos consultados</small>
                {area.files.map((f) => (
                  <code key={f}>{f}</code>
                ))}
              </details>
            ))}
          </aside>
        </div>
      )}
    </>
  )
}
