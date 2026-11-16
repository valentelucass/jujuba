import { useEffect, useRef } from 'react'
import { ArrowLeft, Check, ChevronRight, PanelRight } from 'lucide-react'
import jujuba from '../assets/jujuba.png'
import { engineOrder, engines, type Engine } from '../models/engines'

type EngineOptionsProps = {
  selected: Engine | null
  choose: (engine: Engine) => void
}

function EngineOptions({ selected, choose }: EngineOptionsProps) {
  return <ul className="engine-list">
    {engineOrder.map((engine) => <li key={engine}>
      <button type="button" className="engine-option" aria-current={selected === engine ? true : undefined}
        onClick={() => choose(engine)}>
        <span className="engine-icon"><img src={engines[engine].icon} alt="" /></span>
        <strong>{engines[engine].name}</strong>
        {selected === engine ? <Check size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
      </button>
    </li>)}
  </ul>
}

export function SelectedEngine({ engine }: { engine: Engine | null }) {
  return <aside className="details engine-panel" aria-labelledby="engine-picker-title">
    <div className="panel-title"><PanelRight size={15} /><h2 id="engine-picker-title">Bancos de dados</h2></div>
    <div className="details-body">
      <ul className="engine-list">
        {engineOrder.map((option) => <li key={option} className="engine-option engine-selection"
          aria-current={option === engine ? true : undefined}>
          <span className="engine-icon"><img src={engines[option].icon} alt="" /></span>
          <strong>{engines[option].name}</strong>
          {option === engine && <Check size={15} aria-hidden="true" />}
        </li>)}
      </ul>
    </div>
  </aside>
}

export function CenterEnginePicker({ selected, choose, back }: EngineOptionsProps & { back: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])

  return <section className="welcome-content welcome-engines" aria-labelledby="center-engine-title"
    onKeyDown={(event) => { if (event.key === 'Escape') back() }}>
    <div className="welcome-mark" aria-hidden="true"><img src={jujuba} alt="" /></div>
    <div className="welcome-picker-heading">
      <h1 id="center-engine-title" ref={heading} tabIndex={-1}>Escolha o tipo de banco</h1>
      <button type="button" className="button" onClick={back}><ArrowLeft size={15} /> Voltar</button>
    </div>
    <EngineOptions selected={selected} choose={choose} />
  </section>
}
