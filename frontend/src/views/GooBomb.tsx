import { useEffect, useId, useMemo, useRef, type CSSProperties } from 'react'
import { Crosshair } from 'lucide-react'
import type { Point } from '../controllers/mascotMotion'
import { gooBombTiming, type GooBombPhase, type GooSplash } from '../models/mascotScene'

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

export function GooBomb({ point, phase, splash }: { point: Point; phase: GooBombPhase; splash?: GooSplash }) {
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
      {splash && <GelSpatter point={point} splash={splash} />}
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

const spatterEdges = [[.04, .10], [.51, .055], [.955, .14], [.96, .48], [.955, .88], [.5, .936], [.045, .90], [.044, .46]]
const stainShapes = [
  'M47 22C52 12 48 4 56 3C64 2 60 21 68 22C78 23 79 10 85 16C92 23 76 31 82 36C90 43 99 34 100 41C103 48 82 48 79 54C74 60 88 68 80 74C72 80 66 65 58 67C52 69 61 87 53 91C41 97 48 71 39 66C34 63 27 75 20 69C11 62 29 58 25 52C20 44 2 51 3 41C4 31 24 38 28 30C32 23 16 19 23 13C31 7 39 31 47 22Z',
  'M36 25C44 21 39 7 48 6C56 5 52 27 63 27C69 26 69 14 76 18C83 22 73 32 83 35C91 37 96 31 100 38C105 46 80 48 79 55C76 64 89 69 83 77C77 83 65 68 58 69C48 69 53 95 42 94C31 92 43 67 34 64C25 60 21 83 13 76C5 68 27 56 23 49C20 41 3 43 3 36C3 29 23 35 27 30C30 25 10 18 17 11C24 4 29 27 36 25Z',
]

function GelSpatter({ point, splash }: { point: Point; splash: GooSplash }) {
  const { innerWidth: width, innerHeight: height } = window
  const stains = useMemo(() => {
    const count = Math.min(52, 25 + splash.bodies * 3)
    return Array.from({ length: count }, (_, id) => {
      const [horizontal, vertical] = spatterEdges[id] ?? [.075 + (id * .618034 % 1) * .85, .09 + (id * .414214 % 1) * .80]
      const x = width * horizontal - point.x
      const y = height * vertical - point.y
      const distance = Math.hypot(x, y)
      const lift = Math.min(122, distance * .24)
      const travel = Math.min(890, 330 + distance * .46)
      const start = id * 37 % 177
      const size = id * 19 % 56 + 26
      const fade = 3260 + id * 83 % 1100
      return {
        shape: stainShapes[id % stainShapes.length],
        style: {
          '--gel-x': x + 'px', '--gel-y': y + 'px',
          '--gel-mid-x': x * .48 + 'px', '--gel-mid-y': y * .44 - lift + 'px',
          '--gel-flight': Math.round(travel) + 'ms', '--gel-start': start + 'ms',
          '--gel-hit': Math.round(travel) + start + 'ms', '--gel-fade': fade + 'ms',
          '--gel-size': size + 'px', '--gel-angle': (id * 53 % 121 - 60) + 'deg',
          '--gel-drift': 8 + id * 11 % 21 + 'px', '--gel-color': splash.colors[id % splash.colors.length],
        } as CSSProperties,
      }
    })
  }, [point.x, point.y, splash, width, height])
  return <div className="goo-bomb-spatter" aria-hidden="true">
    {stains.map(({ style, shape }, id) => <span className="goo-gel" key={id} style={style}>
      <i className="goo-gel-flight" />
      <svg className="goo-gel-stain" viewBox="0 0 105 100">
        <path className="goo-gel-shape" d={shape} />
        <path className="goo-gel-gloss" d="M26 43q6-9 16-11m-14 17q2-3 5-4M74 54l-4 3" />
        <circle className="goo-gel-shape" cx="7" cy="13" r="3.2" />
        <circle className="goo-gel-shape" cx="96" cy="73" r="3.5" />
        <circle className="goo-gel-shape" cx="19" cy="88" r="2.4" />
      </svg>
    </span>)}
  </div>
}
