import { Crosshair, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { FlightBounds, Point } from '../controllers/mascotMotion'
import { reflect, traceProjectile, unitVector, type MascotTarget, type ShotTarget } from '../controllers/mascotProjectile'
import { bowCharge } from '../controllers/mascotBow'
import type { MascotImpulse } from '../models/flowMascot'

export type MascotTool = 'blaster' | 'bow'
type Shot = { id: number; point: Point; direction: Point; speed: number; power: number; rebounds: number; expires: number; touched: Set<MascotTarget> }
type Hold = { id: number; start: Point; chargedFor: number; lastCharge: number }
type BowDraw = { anchor: Point; direction: Point; power: number; stretch: number; boost: number }
type Spark = { id: number; point: Point; kind: 'muzzle' | 'impact' }
export const toyLabels: Record<MascotTool, string> = { blaster: 'Pistola de geleia', bow: 'Arco de repulsão' }

const angle = (direction: Point) => Math.atan2(direction.y, direction.x) * 180 / Math.PI
const offset = (point: Point, direction: Point, distance: number): Point => ({
  x: point.x + direction.x * distance, y: point.y + direction.y * distance,
})

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

export function MascotAim({ tool, own, targets, onExit, onFire, onTension, onHit, onRicochet }: {
  tool: MascotTool; own: Point; targets: ShotTarget[]
  onExit: () => void; onFire: (power: number) => void; onTension: (power: number) => void; onRicochet: () => void
  onHit: (target: MascotTarget, impulse: MascotImpulse) => void
}) {
  const [cursor, setCursor] = useState<Point | null>(null)
  const [drawing, setDrawing] = useState<BowDraw | null>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [sparks, setSparks] = useState<Spark[]>([])
  const bowId = useId()
  const engine = useRef({ shots: [] as Shot[], frame: 0, drawFrame: 0, auto: 0, lastFrame: 0, lastShot: -Infinity, sequence: 0 })
  const surface = useRef<HTMLDivElement>(null)
  const weapon = useRef<SVGGElement>(null)
  const held = useRef<Hold | null>(null)
  const lastPointer = useRef<Point | null>(null)
  const runtime = useRef({ own, targets, onHit, onExit, onRicochet, onTension })
  runtime.current = { own, targets, onHit, onExit, onRicochet, onTension }

  useEffect(() => {
    window.getSelection()?.removeAllRanges()
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
      cancelAnimationFrame(animation.drawFrame)
      animation.auto = 0
      setDrawing(null)
      runtime.current.onTension(0)
    }
    function keepPointerInTool(event: Event) {
      event.preventDefault()
    }
    window.addEventListener('keydown', cancelKey, true)
    window.addEventListener('contextmenu', cancelPointer, true)
    window.addEventListener('auxclick', cancelPointer, true)
    window.addEventListener('blur', stopHolding)
    window.addEventListener('selectstart', keepPointerInTool, true)
    window.addEventListener('dragstart', keepPointerInTool, true)
    return () => {
      window.removeEventListener('keydown', cancelKey, true)
      window.removeEventListener('contextmenu', cancelPointer, true)
      window.removeEventListener('auxclick', cancelPointer, true)
      window.removeEventListener('blur', stopHolding)
      window.removeEventListener('selectstart', keepPointerInTool, true)
      window.removeEventListener('dragstart', keepPointerInTool, true)
      cancelAnimationFrame(animation.frame)
      cancelAnimationFrame(animation.drawFrame)
      window.clearInterval(animation.auto)
      animation.frame = 0
      animation.auto = 0
      animation.shots = []
      runtime.current.onTension(0)
    }
  }, [])

  const bow = tool === 'bow'
  function idleDirection(point: Point) {
    return { x: point.x > window.innerWidth / 2 ? -1 : 1, y: 0 }
  }
  function gunPose(where: Point | null) {
    const { own } = runtime.current
    const fallback = idleDirection(own)
    const direction = where ? unitVector(where.x - own.x, where.y - own.y, fallback) : fallback
    const side = Math.abs(direction.x) < .1 ? fallback.x : Math.sign(direction.x)
    const shoulder = { x: own.x + side * 16, y: own.y + 5 }
    const hand = offset(shoulder, direction, 10)
    const vertical = direction.x < 0 ? -1 : 1
    const barrel = offset(hand, direction, 29 * 37 / 32 - 15)
    const muzzle = offset(barrel, { x: -direction.y, y: direction.x }, (12 * 37 / 32 - 18) * vertical)
    return { direction, shoulder, hand, muzzle }
  }

  function bowDraw(anchor: Point, mouse: Point, seconds: number): BowDraw {
    const x = anchor.x - mouse.x
    const y = anchor.y - mouse.y
    return { anchor, direction: unitVector(x, y, idleDirection(anchor)), ...bowCharge(Math.hypot(x, y), seconds) }
  }

  function charge(now: number) {
    const hold = held.current
    const mouse = lastPointer.current
    if (!hold || !mouse) return null
    const elapsed = Math.max(0, Math.min(.1, (now - hold.lastCharge) / 1000))
    hold.lastCharge = now
    if (Math.hypot(mouse.x - hold.start.x, mouse.y - hold.start.y) > 45) hold.chargedFor += elapsed
    else hold.chargedFor = 0
    return bowDraw(hold.start, mouse, hold.chargedFor)
  }

  function chargeFrame(now: number) {
    const ready = charge(now)
    if (!ready) return
    setDrawing(ready)
    runtime.current.onTension(ready.power)
    engine.current.drawFrame = requestAnimationFrame(chargeFrame)
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
        current.onHit(contact.target, { direction: shot.direction, strength: bow ? 290 + 790 * shot.power : 670 })
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

  function fire(where: Point, draw?: BowDraw) {
    const active = engine.current
    const now = performance.now()
    if (now - active.lastShot < 140) return
    active.lastShot = now
    const power = draw?.power ?? 1
    const { muzzle, direction } = draw ? { muzzle: draw.anchor, direction: draw.direction } : gunPose(where)
    const shot = { id: ++active.sequence, point: muzzle, direction, power, speed: bow ? 430 + 920 * power : 860,
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
    if (held.current && event.pointerId !== held.current.id) return
    const where = { x: event.clientX, y: event.clientY }
    setCursor(where)
    lastPointer.current = where
    if (bow && held.current) {
      const ready = charge(performance.now())
      if (ready) setDrawing(ready)
    }
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (held.current || event.button !== 0 || !event.isPrimary ||
      (event.target instanceof Element && event.target.closest('.mascot-aim-status'))) return
    event.preventDefault()
    const where = { x: event.clientX, y: event.clientY }
    track(event)
    held.current = { id: event.pointerId, start: where, chargedFor: 0, lastCharge: performance.now() }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (bow) {
      setDrawing(bowDraw(where, where, 0))
      engine.current.drawFrame = requestAnimationFrame(chargeFrame)
    }
    else {
      fire(where)
      engine.current.auto = window.setInterval(() => { if (lastPointer.current) fire(lastPointer.current) }, 210)
    }
  }

  function release(event: PointerEvent<HTMLDivElement>) {
    const hold = held.current
    if (!hold || hold.id !== event.pointerId) return
    lastPointer.current = { x: event.clientX, y: event.clientY }
    const draw = bow ? charge(performance.now()) : null
    held.current = null
    cancelAnimationFrame(engine.current.drawFrame)
    window.clearInterval(engine.current.auto)
    engine.current.auto = 0
    setDrawing(null)
    onTension(0)
    if (bow && event.type === 'pointerup') {
      const where = { x: event.clientX, y: event.clientY }
      if (draw && draw.stretch >= .025) fire(where, draw)
    }
  }

  const gun = gunPose(cursor)
  const anchor = drawing?.anchor ?? cursor ?? offset(own, idleDirection(own), 112)
  const bowDirection = drawing?.direction ?? idleDirection(anchor)
  const power = drawing?.power ?? 0
  const stretch = drawing?.stretch ?? 0
  const boost = drawing?.boost ?? 0
  const pull = stretch * 205
  const bowSight = offset(anchor, bowDirection, 82 + power * 130)
  const crosshair = drawing ? bowSight : cursor
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
        if (!event.repeat) {
          const direction = unitVector(position.x - own.x, position.y - own.y, idleDirection(own))
          fire(position, bow ? { anchor: offset(position, direction, -90), direction, power: .60, stretch: .60, boost: 0 } : undefined)
        }
      }
    }}>
    <div className="mascot-aim-status" onClick={(event) => event.stopPropagation()}>
      <MascotToyIcon tool={tool} />
      <span className="mascot-aim-instruction">
        <strong>{toyLabels[tool]}</strong>
        <small>{bow ? 'Puxe e segure para carregar. Solte para atirar.' : 'Segure para disparar'}</small>
      </span>
      <button className="icon-button" type="button" title="Guardar ferramenta (Esc ou botão direito)" aria-label="Guardar ferramenta"
        onClick={onExit}><X size={16} /></button>
    </div>
    <svg className={'mascot-held-toy is-' + tool} aria-hidden="true">
      <defs>
        <linearGradient id={bowId + '-limb'} x1="0" y1="-50" x2="0" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffe6a3" /><stop offset=".27" stopColor="#e9a13a" />
          <stop offset=".5" stopColor="#aa5e29" /><stop offset=".76" stopColor="#f3bd58" /><stop offset="1" stopColor="#ffdf8e" />
        </linearGradient>
      </defs>
      {bow ? <>
        {drawing && <>
          <circle className="mascot-bow-anchor" cx={anchor.x} cy={anchor.y} r="8" />
          <line className="mascot-aim-guide" x1={anchor.x} y1={anchor.y} x2={bowSight.x} y2={bowSight.y} />
        </>}
        <g ref={weapon} className={`mascot-bow-rig${drawing ? ' is-drawn' : ''}${boost > .2 ? ' is-boosted' : ''}`}
          data-stretch={stretch.toFixed(3)} data-boost={boost.toFixed(3)} data-power={power.toFixed(3)}
          style={{ '--bow-shake': `${.15 + power * .9}px`, '--bow-tremble': `${135 - power * 30}ms` } as CSSProperties}
          transform={`translate(${anchor.x} ${anchor.y}) rotate(${angle(bowDirection)}) scale(${1.05 + stretch * .16})`}>
          <g className="mascot-bow-body">
            <path className="mascot-bow-aura" d={`M${-8 - stretch * 18} -51C-11-37 23-30 15-8L15 8C23 30-11 37 ${-8 - stretch * 18} 51`} />
            <path className="mascot-bow-limbs" stroke={`url(#${bowId}-limb)`}
              d={`M${-8 - stretch * 18} -51C-11-37 23-30 15-8L15 8C23 30-11 37 ${-8 - stretch * 18} 51`} />
            <path className="mascot-bow-inlay" d="M2-36Q12-31 14-22M14 22Q12 31 2 36" />
            <path className="mascot-bow-string" d={`M${-8 - stretch * 18} -51 L${-pull - 8} 0 L${-8 - stretch * 18} 51`} />
            <rect className="mascot-bow-grip" x="9" y="-10" width="12" height="20" rx="4" />
            <path className="mascot-bow-grip-wrap" d="m10-6 10 3m-10 3 10 3m-10 3 10 3" />
            <circle className="mascot-bow-gem" cx="15" cy="-15" r="3" />
            {drawing && <g className="mascot-bow-nocked" transform={`translate(${-pull - 8} 0) scale(${.9 + power * .5})`}>
              <path className="mascot-bow-shaft" d={`M0 0H${34 + pull / (1 + power * .5)}`} />
              <path className="mascot-bow-fletching" d="M-12-6 2-2 6 0 2 2-12 6-8 0Z" />
              <path className="mascot-bow-head" d={`M${34 + pull / (1 + power * .5)}-6l14 6-14 6 3-6Z`} />
            </g>}
          </g>
        </g>
      </> : <>
        <path className="mascot-toy-arm" d={`M${gun.shoulder.x} ${gun.shoulder.y} Q${gun.shoulder.x} ${gun.hand.y + 9} ${gun.hand.x} ${gun.hand.y}`} />
        <g ref={weapon} transform={`translate(${gun.hand.x} ${gun.hand.y}) rotate(${angle(gun.direction)}) scale(1 ${gun.direction.x < 0 ? -1 : 1})`}>
          <g transform="translate(-15 -18)"><MascotToyIcon tool={tool} size={37} /></g>
        </g>
      </>}
    </svg>
    {crosshair && <span className="mascot-toy-cursor" style={{ left: crosshair.x, top: crosshair.y }}><Crosshair size={20} /></span>}
    {shots.map((shot) => <span key={shot.id} className={'mascot-shot is-' + tool} aria-hidden="true"
      style={{ left: shot.point.x, top: shot.point.y, rotate: angle(shot.direction) + 'deg',
        '--arrow-size': .75 + shot.power * 1.05 } as CSSProperties}><span /></span>)}
    {sparks.map((mark) => <span key={mark.id} className={'mascot-shot-spark is-' + mark.kind} aria-hidden="true"
      style={{ left: mark.point.x, top: mark.point.y }}
      onAnimationEnd={() => setSparks((previous) => previous.filter(({ id }) => id !== mark.id))} />)}
  </div>
}
