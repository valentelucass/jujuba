import type { CSSProperties } from 'react'
import type { Point } from '../controllers/mascotMotion'
import { mapToy, type MascotScene } from '../models/mascotScene'
import type { MascotVisibility } from '../models/flowMascot'
import { JujubaMascot } from './JujubaMascot'
import { MascotToyIcon } from './MascotAim'
import { hats, type Hat } from './MascotHat'
import { MascotYoung } from './SharedMascot'
import { ToyBow } from './ToyBow'

const angle = (direction: Point) => Math.atan2(direction.y, direction.x) * 180 / Math.PI
const noop = () => {}

export function SharedMascotScene({ scene, project, visibility, peer }: {
  scene: MascotScene; project: (point: Point) => Point; visibility: MascotVisibility; peer: string
}) {
  const toy = scene.toy && mapToy(scene.toy, project)
  const companion = scene.clone
  const clonePoint = companion && project(companion.point)
  return <div className={'mascot-shared-scene is-' + visibility} aria-label={'Cena de ' + peer}>
    {companion && clonePoint && <div className={'assistant-peer is-companion' +
      (companion.pose === 'held' ? ' is-grabbed' : '') + (companion.flight ? ' is-flying' : '')}
      role="img" aria-label={'Clone de ' + peer} style={{ left: clonePoint.x - 33, top: clonePoint.y - 33 }}>
      <JujubaMascot hat={Object.hasOwn(hats, companion.hat) ? companion.hat as Hat : 'none'} grabbed={companion.pose === 'held'}
        greeting={companion.greeting ?? undefined} direction={companion.direction ?? undefined}
        flight={companion.flight ? { ...clonePoint, ...companion.flight, velocity: { x: companion.flight.velocityX, y: 0 } } : null} />
      <span className="mascot-clone-label" aria-hidden="true">Clone</span>
    </div>}
    {scene.young.map((child) => {
      const at = project(child.point)
      return <div key={child.id} className="mascot-shared-young">
        <MascotYoung at={at} child={{ id: child.id, x: at.x, phase: child.phase, held: child.held,
          flight: child.rotation || child.squash || child.held ? { ...at, velocity: { x: child.rotation * 95, y: 0 },
            squash: child.squash, edge: 'bottom' } : null }}
          interactive={false} onHatch={noop} onGone={noop} onTouch={noop} onGrab={noop} onMove={noop} onRelease={noop} />
      </div>
    })}
    {toy && <>
      <svg className={'mascot-held-toy is-' + toy.kind} aria-hidden="true">
        {toy.kind === 'bow'
          ? <ToyBow anchor={toy.anchor} direction={toy.direction} stretch={toy.stretch} boost={toy.boost} power={toy.power} drawn={toy.stretch > .001} />
          : <>
            <path className="mascot-toy-arm" d={`M${toy.shoulder.x} ${toy.shoulder.y} Q${toy.shoulder.x} ${toy.hand.y + 9} ${toy.hand.x} ${toy.hand.y}`} />
            <g transform={`translate(${toy.hand.x} ${toy.hand.y}) rotate(${angle(toy.direction)}) scale(1 ${toy.direction.x < 0 ? -1 : 1})`}>
              <g transform="translate(-15 -18)"><MascotToyIcon tool="blaster" size={37} /></g>
            </g>
          </>}
      </svg>
      {toy.shots.map((shot) => <span key={toy.epoch + '-' + shot.id} className={'mascot-shot is-' + toy.kind} aria-hidden="true"
        style={{ left: shot.point.x, top: shot.point.y, rotate: angle(shot.direction) + 'deg',
          '--arrow-size': .75 + shot.power * 1.05 } as CSSProperties}><span /></span>)}
      {toy.sparks.map((spark) => <span key={toy.epoch + '-' + spark.id} className={'mascot-shot-spark is-' + spark.kind} aria-hidden="true"
        style={{ left: spark.point.x, top: spark.point.y }} />)}
    </>}
  </div>
}
