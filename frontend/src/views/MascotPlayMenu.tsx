import { ArrowUpFromLine, Fan, Hand, Magnet, PartyPopper, Stamp, Waves } from 'lucide-react'
import type { PlaygroundTool } from './MascotPlayground'

export type PlayTool = PlaygroundTool | 'magnet'
const toys = [
  { id: 'bubbles', label: 'Bolhas de sabão', icon: Waves },
  { id: 'trampoline', label: 'Trampolim', icon: ArrowUpFromLine },
  { id: 'fan', label: 'Ventilador de bolso', icon: Fan },
  { id: 'magnet', label: 'Ímã de filhotes', icon: Magnet },
] as const

const gestures = [
  { key: 'confetti', label: 'Pote de confeitos', hint: 'Sacuda a Jujuba ao arrastar.', icon: PartyPopper },
  { key: 'tickles', label: 'Cócegas', hint: 'Esfregue a barriga com o ponteiro.', icon: Hand },
  { key: 'stamps', label: 'Carimbo de geleia', hint: 'Arremesse para carimbar a cada quique.', icon: Stamp },
] as const

export type GestureSettings = Record<typeof gestures[number]['key'], boolean>
const storageKey = 'jujuba.assistant.gestures'

export function readGestures(): GestureSettings {
  const settings = { confetti: true, tickles: true, stamps: true }
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    for (const { key } of gestures) if (typeof stored?.[key] === 'boolean') settings[key] = stored[key]
  } catch { /* Gestures start enabled when storage is unavailable. */ }
  return settings
}

export function saveGestures(settings: GestureSettings) {
  try { localStorage.setItem(storageKey, JSON.stringify(settings)) } catch { /* Keep the in-session choice. */ }
}

export function PlayTools({ choose, paused, magnetAvailable }: {
  choose: (tool: PlayTool) => void; paused: boolean; magnetAvailable: boolean
}) {
  return toys.map(({ id, icon: Icon, label }) => {
    const needsYoung = id === 'magnet' && !magnetAvailable
    return <button className="button" type="button" key={id} aria-label={label}
      aria-describedby={needsYoung ? 'magnet-requires-young' : undefined} onClick={() => choose(id)} disabled={paused || needsYoung}>
      <Icon size={16} aria-hidden="true" /><span>{label}
        {needsYoung && <><br /><small id="magnet-requires-young">Precisa de um filhote</small></>}
      </span>
    </button>
  })
}

export function GestureControls({ settings, change, paused }: {
  settings: GestureSettings; change: (settings: GestureSettings) => void; paused: boolean
}) {
  return <fieldset className="mascot-gestures" disabled={paused}>
    <legend>Gestos da Jujuba</legend>
    {gestures.map(({ key, icon: Icon, label, hint }) => <label key={key}>
      <Icon size={16} aria-hidden="true" />
      <span>{label}<small id={'jujuba-hint-' + key}>{hint}</small></span>
      <input type="checkbox" aria-label={label} aria-describedby={'jujuba-hint-' + key} checked={settings[key]}
        onChange={(event) => change({ ...settings, [key]: event.target.checked })} />
    </label>)}
  </fieldset>
}
