import { useEffect, useRef, type CSSProperties } from 'react'
import { Crosshair } from 'lucide-react'
import type { Point } from '../controllers/mascotMotion'

export function GooBombAim({ launch, cancel }: { launch: (point: Point) => void; cancel: () => void }) {
  const aim = useRef<HTMLButtonElement>(null)
  useEffect(() => { aim.current?.focus() }, [])
  return <button type="button" ref={aim} className="goo-bomb-aim"
    aria-label="Clique para lançar a bomba de geleia. Escape para cancelar."
    onClick={(event) => launch(event.detail ? { x: event.clientX, y: event.clientY }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 })}
    onContextMenu={(event) => { event.preventDefault(); cancel() }}
    onKeyDown={(event) => { if (event.key === 'Escape') cancel() }}>
    <span><Crosshair size={18} aria-hidden="true" />Clique para lançar <kbd>Esc</kbd></span>
  </button>
}

const particles = Array.from({ length: 28 }, (_, id) => {
  const angle = (id * 137.5) * Math.PI / 180
  const reach = 90 + (id * 47 % 295)
  return { id, x: Math.cos(angle) * reach, y: Math.sin(angle) * reach, size: 4 + id * 7 % 15, delay: id % 7 * 21 }
})

export function GooBomb({ point, exploded }: { point: Point; exploded: boolean }) {
  return <div className={'goo-bomb ' + (exploded ? 'is-burst' : 'is-charging')}
    role="img" aria-label={exploded ? 'Explosão de geleia' : 'Bomba de geleia puxando os filhotes'}
    style={{ left: point.x, top: point.y, '--missile-rise': -point.y - 110 + 'px' } as CSSProperties}>
    {exploded ? <>
      <div className="goo-bomb-bloom" />
      <div className="goo-bomb-wave" />
      <div className="goo-bomb-wave is-second" />
    </> : <>
      <div className="goo-bomb-vortex" />
      <div className="goo-bomb-meter" />
      <svg className="goo-bomb-missile" aria-hidden="true" viewBox="0 0 68 98">
        <path className="goo-bomb-exhaust" d="M24 20Q34-15 44 20Q42 34 34 38Q26 34 24 20Z" />
        <path fill="#e057a3" stroke="#ffb2df" strokeWidth="2" d="M27 36 13 19 7 48l15 15m19-27 14-17 6 29-15 15" />
        <path fill="#a91c68" stroke="#ffc1e6" strokeWidth="2.6" d="M18 49Q15 74 34 92Q53 74 50 49L44 26H24Z" />
        <path fill="#f6a1d1" d="M23 53Q20 70 34 84Q30 68 36 31H26Z" />
        <circle cx="34" cy="61" r="8" fill="#36152b" stroke="#ffd578" strokeWidth="2.8" />
        <circle cx="35" cy="63" r="3.5" fill="#ffecc4" />
        <path d="M27 32h14" stroke="#63113c" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </>}
    {particles.map(({ id, x, y, size, delay }) => <span key={id} className="goo-bomb-drop"
      style={{ '--drop-x': x + 'px', '--drop-y': y + 'px', '--drop-size': size + 'px', '--drop-delay': delay + 'ms' } as CSSProperties} />)}
  </div>
}
