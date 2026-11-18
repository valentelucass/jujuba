import { useEffect, useId, useRef, type CSSProperties } from 'react'
import { Crosshair } from 'lucide-react'
import type { Point } from '../controllers/mascotMotion'
import { gooBombTiming, type GooBombPhase } from '../models/mascotScene'

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

const particles = Array.from({ length: 34 }, (_, id) => {
  const angle = (id * 137.5) * Math.PI / 180
  const reach = 105 + (id * 59 % 465)
  return {
    id, x: Math.cos(angle) * reach, y: Math.sin(angle) * reach,
    size: 3 + id * 7 % 10, delay: id % 11 * 46, angle: angle * 180 / Math.PI,
  }
})

const labels: Record<GooBombPhase, string> = {
  falling: 'Bomba de geleia caindo',
  landed: 'Bomba de geleia pousou',
  charging: 'Bomba de geleia puxando os filhotes',
  burst: 'Clarão da bomba de geleia',
}

export function GooBomb({ point, phase }: { point: Point; phase: GooBombPhase }) {
  const key = useId()
  const body = key + '-body'
  const rim = key + '-rim'
  const fuse = key + '-fuse'
  const burst = phase === 'burst'
  const charging = phase === 'charging'
  return <div className={'goo-bomb is-' + phase} role="img" aria-label={labels[phase]}
    style={{ left: point.x, top: point.y,
      '--bomb-x': point.x + 'px', '--bomb-y': point.y + 'px', '--fall-rise': -point.y - 94 + 'px',
      '--fall-time': gooBombTiming.landing + 'ms', '--charge-time': gooBombTiming.burst - gooBombTiming.pull + 'ms',
    } as CSSProperties}>
    {phase !== 'falling' && <div className={'goo-bomb-sky' + (burst ? ' is-lit' : '')} />}
    {burst ? <>
      <div className="goo-bomb-afterglow" />
      <div className="goo-bomb-flare" />
      <div className="goo-bomb-wave" />
      <div className="goo-bomb-wave is-second" />
    </> : <>
      {phase === 'falling' && <div className="goo-bomb-target" />}
      {phase !== 'falling' && <div className="goo-bomb-landing-light" />}
      {charging && <>
        <div className="goo-bomb-vortex" />
        <div className="goo-bomb-pull-ring" />
        <div className="goo-bomb-pull-ring is-second" />
        <div className="goo-bomb-pull-ring is-third" />
      </>}
      <svg className="goo-bomb-body" viewBox="0 0 112 130" aria-hidden="true">
        <defs>
          <radialGradient id={body} cx="34%" cy="24%" r="76%">
            <stop stopColor="#64586e" />
            <stop offset=".29" stopColor="#38323f" />
            <stop offset=".69" stopColor="#201822" />
            <stop offset="1" stopColor="#110d14" />
          </radialGradient>
          <linearGradient id={rim} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#c3a7ad" />
            <stop offset=".53" stopColor="#49393f" />
            <stop offset="1" stopColor="#241b23" />
          </linearGradient>
          <linearGradient id={fuse} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#ffe6a6" />
            <stop offset="1" stopColor="#c4844a" />
          </linearGradient>
        </defs>
        <path d="M54 39C51 31 48 22 52 16C56 9 66 8 72 13" fill="none" stroke="#211418"
          strokeWidth="10" strokeLinecap="round" />
        <path d="M54 39C51 31 48 22 52 16C56 9 66 8 72 13" fill="none" stroke={`url(#${fuse})`}
          strokeWidth="5" strokeLinecap="round" />
        <path d="m49 27 5-2m-3-4 4 .8m-.4-7 2 3.6m4.4-7 1.8 4.2m4.9-4.6-1.2 4.5" fill="none"
          stroke="#946343" strokeWidth="1.1" strokeLinecap="round" />
        <rect x="42" y="31" width="29" height="18" rx="4" fill={`url(#${rim})`} stroke="#1c121d" strokeWidth="2.8" />
        <path d="M47 35.5h18" stroke="#e6bec3" strokeOpacity=".7" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="56" cy="78" r="42" fill={`url(#${body})`} stroke="#130d16" strokeWidth="4" />
        <path d="M24 67C27 51 38 45 54 44" fill="none" stroke="#bfb0bd" strokeOpacity=".49"
          strokeWidth="3" strokeLinecap="round" />
        <ellipse cx="35" cy="59" rx="7.5" ry="3.5" transform="rotate(-42 35 59)" fill="#d0becd" opacity=".39" />
        <path d="M41 112A38 38 0 0 0 90 91" fill="none" stroke="#ff7898" strokeOpacity=".38"
          strokeWidth="2" strokeLinecap="round" />
        {phase !== 'falling' && <g className="goo-bomb-ember">
          <path d="m72 4 2.6 5.4 6-2.5-3.5 5.5 5 4-6.3-.7-3 5.8-.7-6.2-6.2-.9 5.8-2.4Z" fill="#ff8059" />
          <path d="m73 8 1.1 2.8 3.1-.1-2.2 1.7 1.5 2.5-2.9-.8-1.9 2.3.5-3-2.7-1.3 3-.5Z" fill="#fff4b6" />
        </g>}
      </svg>
    </>}
    {(charging || burst) && particles.map(({ id, x, y, size, delay, angle }) => <span key={id} className="goo-bomb-drop"
      style={{ '--drop-x': x + 'px', '--drop-y': y + 'px', '--drop-size': size + 'px',
        '--drop-delay': delay + 'ms', '--drop-angle': angle + 'deg' } as CSSProperties} />)}
  </div>
}
