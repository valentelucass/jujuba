import { Fan, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import type { FlightBounds, FlightFrame, Point } from '../controllers/mascotMotion'
import './MascotPlayground.css'

export type PlaygroundTool = 'bubbles' | 'trampoline' | 'fan'
type PlaygroundProps = {
  point: Point; flight: FlightFrame | null; bounds: FlightBounds; held?: boolean
  onPlace: (point: Point) => void
  onLaunch: (point: Point, velocity: Point) => void
  onExit: () => void
}
type Gesture = PointerEvent<HTMLDivElement>
const radius = 33
const center = (p: Point) => ({ x: p.x + radius, y: p.y + radius })
const atPointer = (e: Gesture) => ({ x: e.clientX, y: e.clientY })
const limit = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const bounded = (p: Point, b: FlightBounds) => ({ x: limit(p.x, b.left, b.right), y: limit(p.y, b.top, b.bottom) })
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function Surface({ title, hint, status, action, onExit, onDown, onMove, onUp, onCancel, children }: {
  title: string; hint: string; status?: string; action?: ReactNode; onExit: () => void; children: ReactNode
  onDown: (e: Gesture) => void; onMove?: (e: Gesture) => void; onUp?: (e: Gesture) => void; onCancel?: () => void
}) {
  const surface = useRef<HTMLDivElement>(null)
  const leave = useRef(onExit)
  leave.current = onExit
  useEffect(() => {
    surface.current?.focus({ preventScroll: true })
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); leave.current() }
    }
    const hidden = () => { if (document.hidden) leave.current() }
    window.addEventListener('keydown', key)
    window.addEventListener('blur', leaveGame)
    document.addEventListener('visibilitychange', hidden)
    function leaveGame() { leave.current() }
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', leaveGame)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [])
  return <><div ref={surface} className="mascot-playground" role="region" aria-label={title} tabIndex={-1}
    onContextMenu={e => { e.preventDefault(); onExit() }}
    onPointerDown={e => { if (e.isPrimary && e.button === 0) onDown(e) }}
    onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel} onLostPointerCapture={onCancel}>
    {children}
  </div>
    <div className="mascot-playground-info" onContextMenu={e => { e.preventDefault(); onExit() }}>
      <div><strong>{title}</strong><small>{hint}</small></div>
      {status && <output>{status}</output>}
      {action}
      <button type="button" className="icon-button" onClick={onExit} aria-label={'Guardar ' + title} title="Guardar (Esc)">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  </>
}

type Bubble = Point & {
  id: number; phase: 'seeking' | 'carrying' | 'free'; age: number
  origin: Point; travelTime: number; pickupY: number
}
function Bubbles(props: PlaygroundProps) {
  const latest = useRef(props)
  latest.current = props
  const bubbles = useRef<Bubble[]>([])
  const next = useRef(0)
  const frame = useRef(0)
  const previous = useRef(0)
  const [visible, show] = useState<Bubble[]>([])
  const [pop, setPop] = useState<(Point & { id: number }) | null>(null)
  const popTimer = useRef(0)

  function burst(b: Bubble) {
    bubbles.current = bubbles.current.filter(item => item !== b)
    if (b.phase === 'carrying') {
      const { onLaunch, onPlace, bounds } = latest.current
      const from = bounded({ x: b.x - radius, y: b.y - radius }, bounds)
      if (reduced()) onPlace({ x: from.x, y: bounds.bottom })
      else onLaunch(from, { x: 0, y: 110 })
    }
    setPop(b)
    show([...bubbles.current])
    window.clearTimeout(popTimer.current)
    popTimer.current = window.setTimeout(() => setPop(null), 260)
  }

  function float(now: number) {
    const dt = Math.min(.05, Math.max(0, (now - previous.current) / 1000))
    previous.current = now
    const { point, onPlace, bounds } = latest.current
    const target = center(point)
    const gentle = reduced()
    const left = bounds.left + radius, right = bounds.right + radius
    const ceiling = bounds.top + radius + 12
    let moving = false
    for (const b of [...bubbles.current]) {
      b.age += dt
      if (b.phase === 'seeking') {
        // Follow the current position even if the Jujuba is falling or bouncing.
        const t = gentle ? 1 : Math.min(1, b.age / b.travelTime)
        b.x = b.origin.x + (target.x - b.origin.x) * t
        b.y = b.origin.y + (target.y - b.origin.y) * t
        if (t === 1 || Math.hypot(b.x - target.x, b.y - target.y) <= 25) {
          b.phase = 'carrying'
          b.x = target.x
          b.y = b.pickupY = target.y
        }
        moving = true
      }
      if (b.phase === 'carrying') {
        const bottom = bounds.bottom + radius
        b.x = limit(b.x, left, right)
        b.y = limit(b.y, bounds.top + radius, bottom)
        const goalY = Math.min(bottom, gentle ? Math.max(ceiling, b.pickupY - 26) : ceiling)
        const goalX = limit(gentle ? b.x : b.origin.x, left, right)
        b.x += limit(goalX - b.x, -145 * dt, 145 * dt)
        b.y += limit(goalY - b.y, -(gentle ? 28 : 60) * dt, 60 * dt)
        onPlace(bounded({ x: b.x - radius, y: b.y - radius }, bounds))
        moving ||= Math.abs(b.y - goalY) > .01 || Math.abs(b.x - goalX) > .01
      } else if (b.phase === 'free') {
        b.y -= dt * (gentle ? 28 : 78)
        b.x = limit(b.origin.x + (gentle ? 0 : Math.sin(b.age * 1.55) * 12), left, right)
        if (b.y <= bounds.top + radius || b.age > 32) bubbles.current = bubbles.current.filter(item => item !== b)
        else moving = true
      }
    }
    show([...bubbles.current])
    frame.current = moving ? requestAnimationFrame(float) : 0
  }

  function animate() {
    if (!frame.current && bubbles.current.length) {
      previous.current = performance.now()
      frame.current = requestAnimationFrame(float)
    }
  }
  function blow(at: Point) {
    const { bounds, point } = latest.current
    const origin = center(bounded({ x: at.x - radius, y: at.y - radius }, bounds))
    const target = center(point)
    const occupied = bubbles.current.some(b => b.phase !== 'free')
    if (bubbles.current.length >= 12) {
      const oldest = bubbles.current.find(b => b.phase === 'free')
      bubbles.current = bubbles.current.filter(b => b !== oldest)
    }
    const travelTime = limit(Math.hypot(target.x - origin.x, target.y - origin.y) / 740, .18, .9)
    bubbles.current.push({ ...origin, origin, phase: occupied ? 'free' : 'seeking',
      age: 0, travelTime, pickupY: 0, id: ++next.current })
    show([...bubbles.current])
    animate()
  }
  useEffect(animate, [props.bounds.left, props.bounds.top, props.bounds.right, props.bounds.bottom])
  useEffect(() => {
    const held = bubbles.current.find(b => b.phase === 'carrying')
    if (held && Math.hypot(held.x - props.point.x - radius, held.y - props.point.y - radius) > 1) animate()
  }, [props.point.x, props.point.y])
  useEffect(() => () => {
    cancelAnimationFrame(frame.current)
    window.clearTimeout(popTimer.current)
    if (bubbles.current.some(b => b.phase === 'carrying')) {
      const { onPlace, point, bounds } = latest.current
      onPlace({ x: point.x, y: bounds.bottom })
    }
  }, [])
  const carrying = visible.find(b => b.phase === 'carrying')
  const seeking = visible.some(b => b.phase === 'seeking')
  const hint = carrying ? 'Toque na bolha para a Jujuba cair.'
    : seeking ? 'A bolha está buscando a Jujuba…' : 'Toque em qualquer ponto para a bolha buscar a Jujuba.'
  return <Surface title="Bolhas de sabão" hint={hint} onDown={e => blow(atPointer(e))} onExit={props.onExit}
    action={<button type="button" className="button soap-control" aria-label={carrying ? 'Estourar bolha com a Jujuba' : 'Soprar bolha'}
      onClick={() => {
        if (carrying) burst(carrying)
        else blow({ x: (props.bounds.left + props.bounds.right) / 2 + radius, y: props.bounds.bottom + radius })
      }}>{carrying ? 'Estourar' : 'Soprar'}</button>}>
    {seeking && <span aria-hidden="true" className="soap-target" style={{ left: props.point.x + radius, top: props.point.y + radius }} />}
    {visible.map(b => <button key={b.id} type="button" className={'soap-bubble is-' + b.phase}
      aria-label={b.phase === 'carrying' ? 'Soltar a Jujuba' : 'Estourar bolha'}
      onPointerDown={e => {
        if (e.button !== 0 || !e.isPrimary) return
        e.stopPropagation()
        burst(b)
      }}
      onClick={e => { if (e.detail === 0 && bubbles.current.includes(b)) burst(b) }}
      style={{ left: b.x, top: b.y }} />)}
    {pop && <i key={pop.id} className="soap-pop" aria-hidden="true" style={{ left: pop.x, top: pop.y }} />}
  </Surface>
}

const padHalf = 62
const foot = 59
function Trampoline(props: PlaygroundProps) {
  const { point, flight, bounds } = props
  const [pad, setPad] = useState<Point | null>(null)
  const [hits, setHits] = useState(0)
  const [bounce, setBounce] = useState(0)
  const wasHeld = useRef(false)
  const oldFoot = useRef(point.y + foot)
  const lastJump = useRef(-Infinity)
  const lastRest = useRef(false)
  const latest = useRef(props)
  latest.current = props

  function jump(where: Point, speed: number) {
    lastJump.current = performance.now()
    setHits(n => n + 1)
    setBounce(n => n + 1)
    const rest = bounded({ x: latest.current.point.x, y: where.y - foot }, latest.current.bounds)
    if (reduced()) { latest.current.onPlace(rest); return }
    latest.current.onLaunch(rest, {
      x: (latest.current.flight?.velocity.x ?? 0) * .82,
      y: -limit(speed * 1.07, 670, 1120),
    })
  }
  useEffect(() => {
    const nowFoot = point.y + foot
    const last = oldFoot.current
    oldFoot.current = nowFoot
    const released = wasHeld.current && !props.held
    wasHeld.current = !!props.held
    if (!pad || props.held) return
    const over = Math.abs(point.x + radius - pad.x) <= padHalf + 12
    if (reduced() && released) {
      if (over && nowFoot <= pad.y + 8) jump(pad, 0)
      else setHits(0)
      return
    }
    const descending = flight && flight.velocity.y > 0
    if (over && descending && last <= pad.y + 3 && nowFoot >= pad.y - 2 && performance.now() - lastJump.current > 140) {
      jump(pad, flight.velocity.y)
      return
    }
    // Shared flight may bounce at the floor between two rendered frames.
    if (!over && nowFoot >= bounds.bottom + foot - 12 && !lastRest.current) setHits(0)
    lastRest.current = nowFoot >= bounds.bottom + foot - 12
  }, [point.x, point.y, flight, pad, bounds.bottom, props.held])

  function down(e: Gesture) {
    const at = atPointer(e)
    const next = {
      x: limit(at.x, padHalf + 5, Math.max(padHalf + 5, bounds.right + 60 - padHalf)),
      y: limit(at.y, bounds.top + foot + 8, bounds.bottom + foot - 20),
    }
    setPad(next)
    if (Math.abs(point.x + radius - next.x) < padHalf && Math.abs(point.y + foot - next.y) <= 22) jump(next, 0)
  }
  return <Surface title="Trampolim" hint="Toque para posicionar. Arraste a Jujuba e solte sobre a cama."
    status={hits === 1 ? '1 acerto' : hits + ' acertos'} onDown={down} onExit={props.onExit}>
    {pad && <div className="play-trampoline" style={{ left: pad.x, top: pad.y }} aria-hidden="true">
      <i className="play-trampoline-legs" /><i key={bounce} className={'play-trampoline-bed' + (bounce ? ' is-bouncing' : '')} />
    </div>}
  </Surface>
}

function direction(from: Point, to: Point) {
  const dx = to.x - from.x, dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  return length >= 3 ? { x: dx / length, y: dy / length } : { x: 0, y: -1 }
}

function PocketFan(props: PlaygroundProps) {
  const latest = useRef(props)
  latest.current = props
  const gust = useRef<{ id: number; from: Point; aim: Point } | null>(null)
  const [nozzle, setNozzle] = useState<{ from: Point; aim: Point; blowing: boolean } | null>(null)
  const [tenths, score] = useState(0)
  const [best, record] = useState(0)
  const started = useRef<number | null>(null)
  const timer = useRef(0)
  const isRunning = useRef(false)
  const gentleLift = useRef(false)
  function stop() {
    const active = gust.current
    if (active) setNozzle({ ...active, blowing: false })
    gust.current = null
    if (reduced()) {
      window.clearInterval(timer.current)
      isRunning.current = false
      if (gentleLift.current) {
        const { point, bounds, onPlace } = latest.current
        onPlace({ x: point.x, y: bounds.bottom })
      }
      gentleLift.current = false
      started.current = null
      score(0)
    }
  }
  function blow() {
    const { point, flight, bounds, onLaunch, onPlace } = latest.current
    const active = gust.current
    if (active) {
      const target = center(point)
      const delta = { x: target.x - active.from.x, y: target.y - active.from.y }
      const along = delta.x * active.aim.x + delta.y * active.aim.y
      const across = Math.abs(delta.x * active.aim.y - delta.y * active.aim.x)
      if (along > -36 && along < 520 && across < 54 + Math.max(0, along) * .31) {
        if (reduced()) {
          gentleLift.current = true
          onPlace(bounded({ x: point.x + active.aim.x * 4, y: point.y + active.aim.y * 4 }, bounds))
        } else {
          const push = 235 * (1 - Math.max(0, along) / 870)
          onLaunch(point, {
            x: limit((flight?.velocity.x ?? 0) + active.aim.x * push, -850, 850),
            y: limit((flight?.velocity.y ?? 0) + active.aim.y * push, -750, 900),
          })
        }
      }
    }
    const airborne = point.y < bounds.bottom - 12 && (!!flight || gentleLift.current)
    const now = performance.now()
    if (airborne) {
      started.current ??= now
      const duration = Math.floor((now - started.current) / 100)
      score(duration)
      record(previous => Math.max(previous, duration))
    } else {
      started.current = null
      score(0)
    }
    if (!active && (!airborne || !flight || reduced())) {
      window.clearInterval(timer.current)
      isRunning.current = false
    }
  }
  function start(e: Gesture) {
    if (gust.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const from = atPointer(e)
    const aim = direction(from, center(props.point))
    gust.current = { id: e.pointerId, from, aim }
    setNozzle({ from, aim, blowing: true })
    blow()
    if (!isRunning.current) {
      isRunning.current = true
      timer.current = window.setInterval(blow, 95)
    }
  }
  function aim(e: Gesture) {
    const active = gust.current
    if (!active || active.id !== e.pointerId) return
    active.aim = direction(active.from, atPointer(e))
    setNozzle({ from: active.from, aim: active.aim, blowing: true })
  }
  useEffect(() => () => window.clearInterval(timer.current), [])
  const formatTime = (n: number) => (n / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' s'
  return <Surface title="Ventilador de bolso" hint="Segure perto da Jujuba e arraste para direcionar o vento."
    status={formatTime(tenths) + ' no ar · melhor ' + formatTime(best)} onDown={start} onMove={aim}
    onUp={e => { if (gust.current?.id === e.pointerId) stop() }} onCancel={stop} onExit={props.onExit}>
    {nozzle && <div className={'pocket-fan' + (nozzle.blowing ? ' is-blowing' : '')} aria-hidden="true"
      style={{ left: nozzle.from.x, top: nozzle.from.y, transform: 'rotate(' + Math.atan2(nozzle.aim.y, nozzle.aim.x) + 'rad)' }}>
      <i className="pocket-fan-handle" /><span><Fan size={32} /></span>
      {nozzle.blowing && <i className="pocket-fan-stream"><b /><b /><b /></i>}
    </div>}
  </Surface>
}

export function MascotPlayground({ tool, ...props }: PlaygroundProps & { tool: PlaygroundTool }) {
  if (tool === 'bubbles') return <Bubbles {...props} />
  if (tool === 'trampoline') return <Trampoline {...props} />
  return <PocketFan {...props} />
}
