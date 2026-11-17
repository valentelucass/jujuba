import { Heart, Sparkles, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import jujuba from '../assets/jujuba.png'
import { JujubaMascot } from './JujubaMascot'
import { hats, type Hat } from './MascotHat'
import type { Point } from '../controllers/mascotMotion'
import type { MascotMeetingKind, MascotPresence, MascotVisibility } from '../models/flowMascot'

export function SharedMascot({ peer, appearance, visibility, greeting, direction }: {
  peer: string
  appearance: MascotPresence & { point: Point }
  visibility: MascotVisibility
  greeting?: MascotMeetingKind
  direction: Point
}) {
  const { point, hat, pose, flight } = appearance
  const classes = ['assistant-peer', 'is-' + visibility]
  if (pose === 'held') classes.push('is-grabbed')
  if (pose === 'wary' || pose === 'scared') classes.push('is-' + pose)
  if (flight) classes.push('is-flying')
  return <div className={classes.join(' ')} role="img" aria-label={'Jujuba de ' + peer}
    data-pose={flight ? 'flight' : pose} style={{ left: point.x, top: point.y }}>
    <JujubaMascot hat={Object.hasOwn(hats, hat) ? hat as Hat : 'none'} grabbed={pose === 'held'}
      reaction={pose === 'wary' || pose === 'scared' ? pose : null} greeting={greeting} direction={direction}
      flight={flight ? { ...point, edge: flight.edge, squash: flight.squash, velocity: { x: flight.velocityX, y: 0 } } : null} />
  </div>
}

export function MascotMeetingEffect({ kind, point }: { kind: MascotMeetingKind; point: Point }) {
  const Icon = kind === 'kiss' || kind === 'hug' ? Heart : kind === 'bounce' || kind === 'bump' || kind === 'push' ? Zap : Sparkles
  return <div className={'jujuba-meeting jujuba-meeting-' + kind} aria-hidden="true"
    style={{ left: point.x + 33, top: point.y + 12 }}>
    <Icon size={24} />
    <Icon size={15} />
    <Icon size={12} />
  </div>
}

export function MascotHatchlings({ hug, size, onHatch }: {
  hug: { key: string; point: Point } | null; size: number; onHatch: () => void
}) {
  const [eggs, setEggs] = useState<Array<{ id: string; point: Point; color: number }>>([])
  const center = useRef(hug?.point)
  center.current = hug?.point
  const hugKey = hug?.key
  useEffect(() => {
    if (!hugKey) return
    const timers = [3200, 4500, 5800].map((delay, index) => window.setTimeout(() => {
      if (!center.current) return
      const x = center.current.x + size / 2 + (index - 1) * 34
      const point = {
        x: Math.max(20, Math.min(window.innerWidth - 20, x)),
        y: Math.max(90, center.current.y - 10 - (index % 2) * 24),
      }
      setEggs((previous) => [...previous, { id: hugKey + '-' + index, point, color: index }])
    }, delay))
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [hugKey, size])

  return eggs.map(({ id, point, color }) => <div key={id} className={`jujuba-egg jujuba-egg-${color}`}
    aria-hidden="true" style={{ left: point.x, top: point.y }}
    onAnimationEnd={(event) => {
      if (event.target === event.currentTarget) setEggs((previous) => previous.filter((egg) => egg.id !== id))
    }}>
    <span className="jujuba-egg-top" /><span className="jujuba-egg-bottom" />
    <img className="jujuba-hatchling" src={jujuba} alt="" draggable={false} onAnimationStart={onHatch} />
  </div>)
}
