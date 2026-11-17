import { Crosshair, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { FlightBounds, Point } from '../controllers/mascotMotion'
import { reflect, traceProjectile, unitVector, type MascotTarget, type ShotTarget } from '../controllers/mascotProjectile'
import type { MascotImpulse } from '../models/flowMascot'

export type MascotTool = 'blaster' | 'bow'
type Shot = { id: number; point: Point; direction: Point; speed: number; power: number; rebounds: number; expires: number; touched: Set<MascotTarget> }
type Hold = { id: number; start: Point; direction: Point }
type Spark = { id: number; point: Point; kind: 'muzzle' | 'impact' }
export const toyLabels: Record<MascotTool, string> = { blaster: 'Pistola de geleia', bow: 'Arco de repulsão' }

const angle = (direction: Point) => Math.atan2(direction.y, direction.x) * 180 / Math.PI
const offset = (point: Point, direction: Point, distance: number): Point => ({
  x: point.x + direction.x * distance, y: point.y + direction.y * distance,
})
const drawPower = (hold: Hold, mouse: Point) => Math.max(0, Math.min(1,
  ((hold.start.x - mouse.x) * hold.direction.x + (hold.start.y - mouse.y) * hold.direction.y) / 155))

export function MascotToyIcon({ tool, size = 22 }: { tool: MascotTool; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {tool === 'blaster' ? <>
      <path d="M7 8h15q4 0 4 4v4H15l-2 7H7l2-7H6a3 3 0 0 1-3-3v-1a4 4 0 0 1 4-4Z" fill="var(--berry-selected)" />
      <path d="M26 10h3v4h-3M10 12h7m-5 7h2" /><circle cx="21" cy="12" r="1" fill="var(--mint)" />
    </> : <>
      <path d="M12 3c15 2 15 24 0 26l-6-13Z" fill="var(--gold-surface)" /><path d="M4 16h25m-4-4 4 4-4 4" />
    </>}
  </svg>
}

export function MascotAim({ tool, own, targets, onExit, onFire, onHit, onRicochet }: {
  tool: MascotTool; own: Point; targets: ShotTarget[]
  onExit: () => void; onFire: (power: number) => void; onRicochet: () => void
  onHit: (target: MascotTarget, impulse: MascotImpulse) => void
}) {
  const [cursor, setCursor] = useState<Point | null>(null)
  const [drawing, setDrawing] = useState<{ direction: Point; power: number } | null>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [sparks, setSparks] = useState<Spark[]>([])
  const engine = useRef({ shots: [] as Shot[], frame: 0, auto: 0, lastFrame: 0, lastShot: -Infinity, sequence: 0 })
  const surface = useRef<HTMLDivElement>(null)
  const weapon = useRef<SVGGElement>(null)
  const held = useRef<Hold | null>(null)
  const lastPointer = useRef<Point | null>(null)
  const runtime = useRef({ own, targets, onHit, onExit, onRicochet })
  runtime.current = { own, targets, onHit, onExit, onRicochet }

  useEffect(() => {
    surface.current?.focus()
    const animation = engine.current
    function cancelKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      runtime.current.onExit()
    }
    function cancelPointer(event: MouseEvent) {
      if (event.type === 'auxclick' && event.button !== 2) return
      event.preventDefault()
      event.stopPropagation()
      runtime.current.onExit()
    }
    function stopHolding() {
      held.current = null
      window.clearInterval(animation.auto)
      animation.auto = 0
      setDrawing(null)
    }
    window.addEventListener('keydown', cancelKey, true)
    window.addEventListener('contextmenu', cancelPointer, true)
    window.addEventListener('auxclick', cancelPointer, true)
    window.addEventListener('blur', stopHolding)
    return () => {
      window.removeEventListener('keydown', cancelKey, true)
      window.removeEventListener('contextmenu', cancelPointer, true)
      window.removeEventListener('auxclick', cancelPointer, true)
      window.removeEventListener('blur', stopHolding)
      cancelAnimationFrame(animation.frame)
      window.clearInterval(animation.auto)
      animation.frame = 0
      animation.auto = 0
      animation.shots = []
    }
  }, [])

  const bow = tool === 'bow'
  function idleDirection(point: Point) {
    return { x: point.x > window.innerWidth / 2 ? -1 : 1, y: 0 }
  }
  function pose(where: Point | null, fixed?: Point) {
    const { own } = runtime.current
    const fallback = idleDirection(own)
    const direction = fixed ?? (where ? unitVector(where.x - own.x, where.y - own.y, fallback) : fallback)
    const side = Math.abs(direction.x) < .1 ? fallback.x : Math.sign(direction.x)
    const shoulder = { x: own.x + side * 16, y: own.y + 5 }
    const hand = offset(shoulder, direction, 10)
    return { direction, shoulder, hand, muzzle: offset(hand, direction, 18) }
  }

  function sceneBounds(): FlightBounds {
    const box = surface.current?.getBoundingClientRect()
    return { left: 12, right: window.innerWidth - 12, top: (box?.top ?? 58) + 10, bottom: (box?.bottom ?? window.innerHeight - 29) - 10 }
  }

  function spark(point: Point, kind: Spark['kind']) {
    const next = { id: ++engine.current.sequence, point, kind }
    setSparks((previous) => [...previous.slice(-15), next])
  }

  function tick(now: number) {
    const active = engine.current
    active.frame = 0
    const elapsed = Math.min(.055, Math.max(0, (now - active.lastFrame) / 1000))
    active.lastFrame = now
    const area = sceneBounds()
    const current = runtime.current
    const actors: ShotTarget[] = [...current.targets, { point: current.own, target: 'own' }]
    const flying: Shot[] = []
    for (const shot of active.shots) {
      if (now >= shot.expires) continue
      const start = { x: Math.max(area.left, Math.min(area.right, shot.point.x)), y: Math.max(area.top, Math.min(area.bottom, shot.point.y)) }
      const travel = shot.speed * elapsed
      const contact = traceProjectile(start, shot.direction, travel, area, actors, shot.touched)
      if (!contact) {
        flying.push({ ...shot, point: offset(start, shot.direction, travel) })
        continue
      }
      const at = offset(start, shot.direction, contact.distance)
      spark(at, 'impact')
      if (contact.target) {
        shot.touched.add(contact.target)
        current.onHit(contact.target, { direction: shot.direction, strength: bow ? 280 + 970 * shot.power : 670 })
      } else {
        current.onRicochet()
      }
      if (shot.rebounds > 0) {
        const direction = reflect(shot.direction, contact.normal)
        const speed = shot.speed * .9
        flying.push({ ...shot, point: offset(at, direction, 1.5), direction, speed, power: shot.power * .86, rebounds: shot.rebounds - 1 })
      }
    }
    active.shots = flying
    setShots(flying)
    if (flying.length) active.frame = requestAnimationFrame(tick)
  }

  function fire(where: Point, power = bow ? .18 : 1, fixed?: Point) {
    const active = engine.current
    const now = performance.now()
    if (now - active.lastShot < 140) return
    active.lastShot = now
    const { muzzle, direction } = pose(where, fixed)
    const shot = { id: ++active.sequence, point: muzzle, direction, power, speed: bow ? 490 + 650 * power : 860,
      rebounds: bow ? 2 + Math.round(power * 3) : 0, expires: now + (bow ? 6500 : 3200), touched: new Set<MascotTarget>() }
    active.shots = [...active.shots.slice(-7), shot]
    setShots(active.shots)
    spark(muzzle, 'muzzle')
    if (!active.frame) {
      active.lastFrame = now
      active.frame = requestAnimationFrame(tick)
    }
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      weapon.current?.animate([
        { translate: '0 0' }, { translate: `${-direction.x * (bow ? 2 : 6)}px ${-direction.y * (bow ? 2 : 6)}px` }, { translate: '0 0' },
      ], { duration: 155, easing: 'ease-out' })
    }
    onFire(power)
  }

  function track(event: PointerEvent<HTMLDivElement>) {
    const where = { x: event.clientX, y: event.clientY }
    setCursor(where)
    lastPointer.current = where
    if (bow && held.current) setDrawing({ direction: held.current.direction, power: drawPower(held.current, where) })
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (held.current || event.button !== 0 || !event.isPrimary ||
      (event.target instanceof Element && event.target.closest('.mascot-aim-status'))) return
    const where = { x: event.clientX, y: event.clientY }
    track(event)
    held.current = { id: event.pointerId, start: where, direction: pose(where).direction }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (bow) setDrawing({ direction: held.current.direction, power: 0 })
    else {
      fire(where)
      engine.current.auto = window.setInterval(() => { if (lastPointer.current) fire(lastPointer.current) }, 210)
    }
  }

  function release(event: PointerEvent<HTMLDivElement>) {
    const hold = held.current
    if (!hold || hold.id !== event.pointerId) return
    held.current = null
    window.clearInterval(engine.current.auto)
    engine.current.auto = 0
    setDrawing(null)
    if (bow && event.type === 'pointerup') {
      const where = { x: event.clientX, y: event.clientY }
      fire(where, Math.max(.08, drawPower(hold, where)), hold.direction)
    }
  }

  const { direction, hand, shoulder, muzzle } = pose(cursor, drawing?.direction)
  const guide = offset(muzzle, direction, 55)
  const pull = drawing ? 12 + drawing.power * 34 : 0
  const drawHand = offset(hand, direction, -pull)
  const freeShoulder = { x: own.x + (own.x - shoulder.x) * .71, y: own.y + 12 }
  return <div ref={surface} className="mascot-aim" role="group" aria-label={'Mira da ferramenta: ' + toyLabels[tool]} tabIndex={0}
    onPointerMove={track} onPointerDown={start} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
    onPointerLeave={() => setCursor(null)}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return
      const position = cursor ?? targets[0]?.point ?? offset(own, idleDirection(own), 160)
      const x = event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0
      const y = event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0
      if (x || y) {
        event.preventDefault()
        setCursor({ x: Math.max(0, Math.min(window.innerWidth, position.x + x)),
          y: Math.max(0, Math.min(window.innerHeight, position.y + y)) })
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (!event.repeat) fire(position, bow ? .6 : 1)
      }
    }}>
    <div className="mascot-aim-status" onClick={(event) => event.stopPropagation()}>
      <MascotToyIcon tool={tool} />
      <span className="mascot-aim-instruction">
        <strong>{toyLabels[tool]}</strong>
        <small>{bow ? 'Puxe para trás e solte' : 'Segure para disparar'}</small>
      </span>
      <button className="icon-button" type="button" title="Guardar ferramenta (Esc ou botão direito)" aria-label="Guardar ferramenta"
        onClick={onExit}><X size={16} /></button>
    </div>
    <svg className={'mascot-held-toy is-' + tool} aria-hidden="true">
      <line className="mascot-aim-guide" x1={muzzle.x} y1={muzzle.y} x2={guide.x} y2={guide.y} />
      <path className="mascot-toy-arm" d={'M' + shoulder.x + ' ' + shoulder.y + ' Q' + shoulder.x + ' ' +
        (hand.y + 9) + ' ' + hand.x + ' ' + hand.y} />
      {drawing && <path className="mascot-toy-arm" d={`M${freeShoulder.x} ${freeShoulder.y} Q${drawHand.x} ${freeShoulder.y + 7} ${drawHand.x} ${drawHand.y}`} />}
      <g ref={weapon} transform={`translate(${hand.x} ${hand.y}) rotate(${angle(direction)}) scale(1 ${direction.x < 0 ? -1 : 1})`}>
        {bow ? <>
          <path className="mascot-bow-limbs" d="M-4 -20Q19-9 11 0Q19 9 -4 20" />
          <path className="mascot-bow-string" d={`M-4 -20 L${-pull - 4} 0 L-4 20`} />
          {drawing && <path className="mascot-bow-loaded" d={`M${-pull - 4} 0H33m-5-4 5 4-5 4`} />}
        </> : <g transform="translate(-15 -18)"><MascotToyIcon tool={tool} size={37} /></g>}
      </g>
    </svg>
    {cursor && <span className="mascot-toy-cursor" style={{ left: cursor.x, top: cursor.y }}><Crosshair size={20} /></span>}
    {shots.map((shot) => <span key={shot.id} className={'mascot-shot is-' + tool} aria-hidden="true"
      style={{ left: shot.point.x, top: shot.point.y, rotate: angle(shot.direction) + 'deg' }}><span /></span>)}
    {sparks.map((mark) => <span key={mark.id} className={'mascot-shot-spark is-' + mark.kind} aria-hidden="true"
      style={{ left: mark.point.x, top: mark.point.y }}
      onAnimationEnd={() => setSparks((previous) => previous.filter(({ id }) => id !== mark.id))} />)}
  </div>
}
