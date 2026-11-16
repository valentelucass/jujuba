import type { RefObject } from 'react'
import { ChevronRight, PanelRight } from 'lucide-react'
import { engineOrder, engines, type Engine } from '../models/engines'

export function EnginePicker({ choose, firstButton }: {
  choose: (engine: Engine) => void
  firstButton: RefObject<HTMLButtonElement | null>
}) {
  return <aside className="details engine-panel" aria-labelledby="engine-picker-title">
    <div className="panel-title"><PanelRight size={15} /><h2 id="engine-picker-title">Bancos de dados</h2></div>
    <div className="details-body">
      <p className="engine-panel-note">Escolha o tipo de banco para conectar.</p>
      <ul className="engine-list">
        {engineOrder.map((engine) => <li key={engine}>
          <button type="button" className="engine-option" ref={engine === engineOrder[0] ? firstButton : undefined} onClick={() => choose(engine)}>
            <span className="engine-icon"><img src={engines[engine].icon} alt="" /></span>
            <strong>{engines[engine].name}</strong><ChevronRight size={15} aria-hidden="true" />
          </button>
        </li>)}
      </ul>
    </div>
  </aside>
}
