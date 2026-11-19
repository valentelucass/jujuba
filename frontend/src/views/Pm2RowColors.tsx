import { useState } from 'react'
import { Check, Eraser, X } from 'lucide-react'

const palette = [
  ['Vermelho', '#ef4444'], ['Laranja', '#f97316'], ['Amarelo', '#eab308'],
  ['Verde', '#22c55e'], ['Azul', '#3b82f6'], ['Violeta', '#a855f7'],
] as const

export function Pm2RowColors({ count, apply, close }: { count: number; apply: (color?: string) => void; close: () => void }) {
  const [color, setColor] = useState<string>(palette[0][1])
  return <div className="pm2-row-colors" role="group" aria-label="Cores das linhas" onKeyDown={(e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close() }
  }}>
    <span aria-live="polite">{count === 0 ? 'Selecione as linhas' : count === 1 ? '1 linha selecionada' : count + ' linhas selecionadas'}</span>
    <div className="pm2-swatches">{palette.map(([label, value]) => <button key={value} type="button"
      aria-label={label} title={label} aria-pressed={color === value} onClick={() => setColor(value)}
      style={{ backgroundColor: value }}>{color === value && <Check size={13} strokeWidth={3} />}</button>)}
      <label className="pm2-custom-color" title="Cor personalizada"><input aria-label="Cor personalizada" type="color" value={color}
        onChange={(e) => setColor(e.target.value)} /></label>
    </div>
    <button className="button" disabled={!count} onClick={() => apply(color)}>Aplicar cor</button>
    <button className="button" disabled={!count} onClick={() => apply()}><Eraser size={13}/>Limpar cor</button>
    <button className="icon-button" aria-label="Fechar cores" title="Fechar cores" onClick={close}><X size={15}/></button>
  </div>
}
