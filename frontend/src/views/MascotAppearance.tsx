import { Check, Pipette } from 'lucide-react'
import { useState } from 'react'
import { mascotColors } from '../models/mascotColor'
import { JujubaMascot } from './JujubaMascot'
import { hats, MascotHat, type Hat } from './MascotHat'

export function MascotAppearance({ color, hat, changeColor, changeHat }: {
  color: string; hat: Hat; changeColor: (color: string) => void; changeHat: (hat: Hat) => void
}) {
  const [showColors, setShowColors] = useState(false)
  const selected = mascotColors.find((entry) => entry.value === color)
  return <div id="assistant-hats" className="assistant-appearance">
    <div className="appearance-switch" role="group" aria-label="Personalizar aparência">
      <button type="button" aria-pressed={!showColors} onClick={() => setShowColors(false)}>Chapéus</button>
      <button type="button" aria-pressed={showColors} onClick={() => setShowColors(true)}>Cor da Jujuba</button>
    </div>
    {showColors ? <div className="appearance-color" role="group" aria-label="Cor da Jujuba">
      <div className="appearance-sample">
        <span className="appearance-portrait"><JujubaMascot color={color} hat={hat} /></span>
        <div><strong>{selected?.name ?? 'Cor personalizada'}</strong><span>{color.toUpperCase()}</span></div>
      </div>
      <div className="appearance-swatches" role="group" aria-label="Cores prontas">
        {mascotColors.map((entry) => <button key={entry.value} type="button" aria-pressed={color === entry.value}
          title={entry.name} aria-label={entry.name} onClick={() => changeColor(entry.value)}>
          <span style={{ backgroundColor: entry.value }}>{color === entry.value && <Check size={15} strokeWidth={3} />}</span>
        </button>)}
      </div>
      <label className="appearance-custom"><Pipette size={15} aria-hidden="true" />Escolher outra cor
        <input type="color" value={color} onChange={(event) => changeColor(event.target.value)} />
      </label>
    </div> : <div className="assistant-hats" role="group" aria-label="Chapéus da Jujuba">
      {(Object.keys(hats) as Hat[]).map((option) => <button key={option} className="button" type="button"
        aria-pressed={hat === option} onClick={() => changeHat(option)}>
        {option === 'none' ? <span className="hat-miniature" aria-hidden="true">—</span> : <MascotHat hat={option} miniature />}
        <span>{hats[option]}</span>
      </button>)}
    </div>}
  </div>
}
