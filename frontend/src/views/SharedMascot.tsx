import { Heart, Sparkles, Zap } from 'lucide-react'
import { JujubaMascot } from './JujubaMascot'
import { hats, type Hat } from './MascotHat'
import type { Point } from '../controllers/mascotMotion'
import type { MascotMeetingKind, MascotPresence, MascotVisibility } from '../models/flowMascot'

export function SharedMascot({ peer, appearance, visibility, greeting }: {
  peer: string
  appearance: MascotPresence & { point: Point }
  visibility: MascotVisibility
  greeting?: MascotMeetingKind
}) {
  const { point, hat, pose, flight } = appearance
  const classes = ['assistant-peer', 'is-' + visibility]
  if (pose === 'held') classes.push('is-grabbed')
  if (pose === 'wary' || pose === 'scared') classes.push('is-' + pose)
  if (flight) classes.push('is-flying')
  return <div className={classes.join(' ')} role="img" aria-label={'Jujuba de ' + peer}
    data-pose={flight ? 'flight' : pose} style={{ left: point.x, top: point.y }}>
    <JujubaMascot hat={Object.hasOwn(hats, hat) ? hat as Hat : 'none'} grabbed={pose === 'held'}
      reaction={pose === 'wary' || pose === 'scared' ? pose : null} greeting={greeting}
      flight={flight ? { ...point, edge: flight.edge, squash: flight.squash, velocity: { x: flight.velocityX, y: 0 } } : null} />
  </div>
}

export function MascotMeetingEffect({ kind, point }: { kind: MascotMeetingKind; point: Point }) {
  const Icon = kind === 'kiss' ? Heart : kind === 'bounce' ? Zap : Sparkles
  return <div className={'jujuba-meeting jujuba-meeting-' + kind} aria-hidden="true"
    style={{ left: point.x + 33, top: point.y + 12 }}>
    <Icon size={24} />
    <Icon size={15} />
    <Icon size={12} />
  </div>
}
