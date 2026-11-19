import { Magnet, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Point } from '../controllers/mascotMotion'
import type { useMascotBrood } from '../controllers/useMascotBrood'
import './mascotMagnet.css'

type MagnetBrood = Pick<ReturnType<typeof useMascotBrood>, 'aimMagnet' | 'releaseMagnet' | 'magnetAvailable'>

export function MascotMagnet({ brood, onExit }: { brood: MagnetBrood; onExit: () => void }) {
  const surface = useRef<HTMLDivElement>(null)
  const controls = useRef({ brood, onExit })
  controls.current = { brood, onExit }
  const grip = useRef<number | 'keyboard' | null>(null)
  const [active, setActive] = useState(false)
  const [point, setPoint] = useState<Point | null>(null)

  function stop(scatter: boolean) {
    grip.current = null
    controls.current.brood.releaseMagnet(scatter)
    setActive(false)
  }

  useEffect(() => {
    if (!brood.magnetAvailable) controls.current.onExit()
  }, [brood.magnetAvailable])

  useEffect(() => {
    surface.current?.focus()
    const blur = () => stop(false)
    const visibility = () => { if (document.hidden) blur() }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      controls.current.onExit()
    }
    window.addEventListener('keydown', escape, true)
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', visibility)
      controls.current.brood.releaseMagnet(false)
    }
  }, [])

  function aim(next: Point) {
    setPoint(next)
    if (grip.current !== null) controls.current.brood.aimMagnet(next)
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (!brood.magnetAvailable || !event.isPrimary || event.button !== 0 || grip.current !== null ||
      (event.target instanceof Element && event.target.closest('.mascot-aim-status'))) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    grip.current = event.pointerId
    setActive(true)
    aim({ x: event.clientX, y: event.clientY })
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    if (grip.current === event.pointerId) stop(event.type === 'pointerup')
  }

  return <div ref={surface} className="mascot-aim mascot-magnet" tabIndex={0}
    role="group" aria-label="Ímã de filhotes" aria-describedby="mascot-magnet-help"
    aria-keyshortcuts="Space Enter ArrowLeft ArrowRight ArrowUp ArrowDown Escape"
    onPointerDown={start} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onPointerMove={(event) => {
      if (!event.isPrimary || (grip.current !== null && grip.current !== event.pointerId)) return
      aim({ x: event.clientX, y: event.clientY })
    }}
    onPointerLeave={() => { if (grip.current === null) setPoint(null) }}
    onContextMenu={(event) => { event.preventDefault(); onExit() }}
    onBlur={() => { if (grip.current !== null) stop(false) }}
    onKeyDown={(event) => {
      if (!brood.magnetAvailable || event.target !== event.currentTarget || (grip.current !== null && grip.current !== 'keyboard')) return
      const bounds = event.currentTarget.getBoundingClientRect()
      const at = point ?? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
      const step = event.shiftKey ? 42 : 18
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
      if (dx || dy) {
        event.preventDefault()
        aim({ x: Math.max(bounds.left, Math.min(bounds.right, at.x + dx)),
          y: Math.max(bounds.top, Math.min(bounds.bottom, at.y + dy)) })
      } else if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        if (event.repeat) return
        grip.current = 'keyboard'
        setActive(true)
        aim(at)
      }
    }}
    onKeyUp={(event) => {
      if (grip.current === 'keyboard' && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault()
        stop(true)
      }
    }}>
    <div className="mascot-aim-status">
      <Magnet size={21} aria-hidden="true" />
      <span className="mascot-aim-instruction"><strong>Ímã de filhotes</strong>
        <small id="mascot-magnet-help">Segure para atrair, mova o ímã e solte para espalhar.</small>
      </span>
      <button type="button" className="icon-button" title="Guardar ímã (Esc)" aria-label="Guardar ferramenta"
        onClick={onExit}><X size={16} /></button>
    </div>
    {point && <span aria-hidden="true" className={'mascot-magnet-pole' + (active ? ' is-active' : '')}
      style={{ left: point.x, top: point.y }}>
      <Magnet size={29} strokeWidth={2.8} />
    </span>}
  </div>
}
