import { Crosshair, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Point } from '../controllers/mascotMotion'
import type { MascotImpulse } from '../models/flowMascot'

export type MascotTool = 'blaster' | 'bow'
export type MascotTarget = 'own' | 'peer' | 'clone'
type Shot = { id: number; from: Point; to: Point; distance: number; angle: number; direction: Point; target?: MascotTarget }
const radius = 25
export const toyLabels: Record<MascotTool, string> = { blaster: 'Pistola de geleia', bow: 'Arco de repulsão' }

export function MascotToyIcon({ tool, size = 22 }: { tool: MascotTool; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {tool === 'blaster' ? <>
      <path d="M7 8h15q4 0 4 4v4H15l-2 7H7l2-7H6a3 3 0 0 1-3-3v-1a4 4 0 0 1 4-4Z" fill="var(--berry-selected)" />
      <path d="M26 10h3v4h-3M10 12h7m-5 7h2" /><circle cx="21" cy="12" r="1" />
    </> : <>
      <path d="M12 3c15 2 15 24 0 26l-6-13Z" fill="var(--berry-selected)" /><path d="M4 16h25m-4-4 4 4-4 4" />
    </>}
  </svg>
}

export function MascotAim({ tool, own, targets, onExit, onFire, onHit }: {
  tool: MascotTool; own: Point; targets: Array<{ point: Point; target: 'peer' | 'clone' }>
  onExit: () => void; onFire: () => void; onHit: (target: MascotTarget, impulse: MascotImpulse) => void
}) {
  const [cursor, setCursor] = useState<Point | null>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const sequence = useRef(0)
  const surface = useRef<HTMLDivElement>(null)

  useEffect(() => { surface.current?.focus() }, [])

  function aim(where: Point): Omit<Shot, 'id'> {
    const dx = where.x - own.x
    const dy = where.y - own.y
    const length = Math.hypot(dx, dy)
    const direction = length > 1 ? { x: dx / length, y: dy / length } : { x: 0, y: -1 }
    const angle = Math.atan2(direction.y, direction.x) * 180 / Math.PI
    if (length <= radius && targets.every(({ point }) => length <= Math.hypot(where.x - point.x, where.y - point.y))) {
      return { from: { x: own.x - direction.x * 45, y: own.y - direction.y * 45 },
        to: own, direction, angle, distance: 45, target: 'own' }
    }
    let distance = length
    let target: MascotTarget | undefined
    for (const candidate of targets) {
      const x = candidate.point.x - own.x
      const y = candidate.point.y - own.y
      const along = x * direction.x + y * direction.y
      const sideways = Math.abs(x * direction.y - y * direction.x)
      const entry = along - Math.sqrt(Math.max(0, radius ** 2 - sideways ** 2))
      if (along > 0 && sideways <= radius && entry <= distance) {
        distance = Math.max(6, entry)
        target = candidate.target
      }
    }
    return { from: own, to: { x: own.x + direction.x * distance, y: own.y + direction.y * distance },
      direction, angle, distance, target }
  }

  function fire(point: Point) {
    const shot = { ...aim(point), id: ++sequence.current }
    setShots((previous) => [...previous.slice(-11), shot])
    onFire()
  }

  const sight = cursor && aim(cursor)
  return <div ref={surface} className="mascot-aim" role="group" aria-label={`Mira da ferramenta: ${toyLabels[tool]}`} tabIndex={0}
    onPointerMove={(event) => setCursor({ x: event.clientX, y: event.clientY })}
    onPointerLeave={() => setCursor(null)}
    onClick={(event) => fire({ x: event.clientX, y: event.clientY })}
    onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }
      if (event.target !== event.currentTarget) return
      const position = cursor ?? targets[0]?.point ?? own
      const x = event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0
      const y = event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0
      if (x || y) {
        event.preventDefault()
        setCursor({ x: Math.max(0, Math.min(window.innerWidth, position.x + x)),
          y: Math.max(0, Math.min(window.innerHeight, position.y + y)) })
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (!event.repeat) fire(position)
      }
    }}>
    <div className="mascot-aim-status" onClick={(event) => event.stopPropagation()}>
      <MascotToyIcon tool={tool} />
      <span>{toyLabels[tool]}</span>
      <button className="icon-button" type="button" title="Guardar ferramenta (Esc)" aria-label="Guardar ferramenta" onClick={onExit}><X size={16} /></button>
    </div>
    {cursor && sight && <>
      <svg className={`mascot-aim-guide${sight.target ? ' is-targeting' : ''}`} aria-hidden="true">
        <line x1={sight.from.x} y1={sight.from.y} x2={sight.to.x} y2={sight.to.y} />
        <circle cx={sight.to.x} cy={sight.to.y} r="5" />
      </svg>
      <span className="mascot-toy-cursor" style={{ left: cursor.x, top: cursor.y }}>
        <Crosshair size={17} />
        <span style={{ rotate: `${sight.angle}deg` }}><MascotToyIcon tool={tool} size={31} /></span>
      </span>
    </>}
    {shots.map((shot) => <span key={shot.id} className={`mascot-shot is-${tool}`} aria-hidden="true"
      style={{ left: shot.from.x, top: shot.from.y, rotate: `${shot.angle}deg`, '--shot-travel': `${shot.distance}px`,
        '--shot-duration': `${Math.max(100, Math.min(350, shot.distance * .34))}ms` } as CSSProperties}>
      <span onAnimationEnd={() => {
        if (shot.target) onHit(shot.target, { direction: shot.direction, strength: tool === 'bow' ? 925 : 670 })
        setShots((previous) => previous.filter(({ id }) => id !== shot.id))
      }} />
    </span>)}
  </div>
}
