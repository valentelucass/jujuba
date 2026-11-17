import { Heart, Sparkles, Zap } from 'lucide-react'
import type { CSSProperties, PointerEvent } from 'react'
import jujuba from '../assets/jujuba.png'
import { JujubaMascot } from './JujubaMascot'
import { hats, type Hat } from './MascotHat'
import type { Point } from '../controllers/mascotMotion'
import type { Offspring } from '../controllers/useMascotBrood'
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

const tones = [
  ['#f596c2', '#c65394', 0], ['#f8d381', '#ba7827', 83], ['#a8e3c5', '#4c9e81', 184],
  ['#b9acff', '#7669c2', -46], ['#91dfef', '#428fa9', 226], ['#ffa98f', '#d26657', 49],
] as const

export function MascotYoung({ child, at, onHatch, onTouch, onGone, onGrab, onMove, onRelease }: {
  child: Offspring; at: Point; onHatch: () => void; onTouch: () => void; onGone: () => void
  onGrab: (event: PointerEvent<HTMLButtonElement>) => void
  onMove: (event: PointerEvent<HTMLButtonElement>) => void
  onRelease: (event: PointerEvent<HTMLButtonElement>) => void
}) {
  const { id, phase, flight } = child
  const [shell, spot, hue] = tones[(id - 1) % tones.length]
  const squash = flight?.squash ?? 0
  const side = flight?.edge === 'left' || flight?.edge === 'right'
  return <button type="button" className={`jujuba-offspring is-${phase}${flight ? ' is-flying' : ''}${child.held ? ' is-held' : ''}`}
    disabled={phase !== 'young'} aria-label="Cutucar ou arrastar mini-Jujuba" title="Arraste para arremessar"
    onClick={(event) => { if (!event.detail) onTouch() }}
    onPointerDown={onGrab} onPointerMove={onMove} onPointerUp={onRelease} onPointerCancel={onRelease} onLostPointerCapture={onRelease}
    style={{ left: at.x, top: at.y, '--shell': shell, '--shell-spot': spot, '--young-hue': hue + 'deg',
      '--young-idle': `${4 + (id % 5) * .43}s`, '--young-delay': `${-id * .44}s`,
    } as CSSProperties}>
    {phase === 'popping' ? <span className="jujuba-young-pop" onAnimationEnd={onGone} aria-hidden="true" /> : <>
      <span className="jujuba-egg" aria-hidden="true">
        <span className="jujuba-egg-top" /><span className="jujuba-egg-bottom" />
      </span>
      <span className="jujuba-young-motion" style={{ rotate: `${(flight?.velocity.x ?? 0) / 95}deg`,
        scale: side ? `${1 - squash * .38} ${1 + squash * .29}` : `${1 + squash * .29} ${1 - squash * .38}` }}>
        <span className="jujuba-young-body">
        <img className="jujuba-hatchling" src={jujuba} alt="" draggable={false} onAnimationStart={() => {
          if (phase === 'egg') onHatch()
        }} />
        </span>
      </span>
    </>}
  </button>
}
