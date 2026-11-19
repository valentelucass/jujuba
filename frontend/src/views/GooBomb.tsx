import { useEffect, useId, useRef, type CSSProperties } from 'react'
import { Crosshair } from 'lucide-react'
import { BlastCloud } from './BlastCloud'
import { preloadSmoke } from './BlastCanvas'
import { BlastFlow } from './BlastFlow'
import './cinematicBomb.css'
import type { Point } from '../controllers/mascotMotion'
import { gooBombTiming, type GooBombPhase, type GooSplash } from '../models/mascotScene'

export function GooBombAim({ launch, cancel }: { launch: (point: Point) => void; cancel: () => void }) {
  const aim = useRef<HTMLButtonElement>(null)
  useEffect(() => { aim.current?.focus() }, [])
  return <button type="button" ref={aim} className="goo-bomb-aim"
    aria-label="Clique para lançar a bomba. Escape para cancelar."
    onClick={(event) => launch(event.detail ? { x: event.clientX, y: event.clientY }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 })}
    onContextMenu={(event) => { event.preventDefault(); cancel() }}
    onKeyDown={(event) => { if (event.key === 'Escape') cancel() }}>
    <span><Crosshair size={18} aria-hidden="true" />Clique para lançar <kbd>Esc</kbd></span>
  </button>
}

const labels: Record<GooBombPhase, string> = {
  falling: 'Bomba em queda', landed: 'Impacto da bomba', charging: 'Bomba atraindo as Jujubas', burst: 'Explosão e nuvem de fumaça',
}

function BombProp({ id }: { id: string }) {
  const paint = id + '-paint', metal = id + '-metal', grain = id + '-grain'
  return <svg className="bomb-prop" viewBox="0 0 88 180" aria-hidden="true">
    <defs>
      <linearGradient id={paint}>
        <stop stopColor="#222821" /><stop offset=".17" stopColor="#5c6146" /><stop offset=".33" stopColor="#96957a" />
        <stop offset=".48" stopColor="#6c7054" /><stop offset=".74" stopColor="#474d39" /><stop offset="1" stopColor="#242920" />
      </linearGradient>
      <linearGradient id={metal} x2=".7" y2="1">
        <stop stopColor="#a6a38b" /><stop offset=".24" stopColor="#5c624d" /><stop offset=".7" stopColor="#3a4032" /><stop offset="1" stopColor="#272b24" />
      </linearGradient>
      <pattern id={grain} width="13" height="12" patternUnits="userSpaceOnUse">
        <path d="m2 4 2-.4m5 5 .8-.3m2-7 .6-.4" stroke="#dbd2af" strokeWidth=".55" opacity=".46" />
        <path d="m3 10 1.4-.6m4-5 1.8-.3" stroke="#282a20" strokeWidth=".65" opacity=".68" />
      </pattern>
    </defs>
    <g strokeLinejoin="round">
      <path d="m18 9 35-3 17 7-35 4Z" fill="#878a72" stroke="#9a9981" strokeWidth="1.3" />
      <path d="m22 12 29-2 12 4-27 3Z" fill="#353a2e" />
      <path d="m18 9 15 8 11 53-9-5-17-26Z" fill={`url(#${metal})`} stroke="#383e32" />
      <path d="m69 13-1 31-16 24-8 2 11-48Z" fill="#434a39" stroke="#1f251e" />
      <path d="m36 17 6 46 8 6 7-50Z" fill={`url(#${paint})`} />
      <path d="m18 10 17 8v26l-17-6Zm17 8 35-5v26l-35 6Z" fill="none" stroke="#737960" strokeWidth="2.7" />
      <path d="m18 10 17 8 35-5m-34 7v23" fill="none" stroke="#b4b197" strokeWidth="1.1" />
      <path d="M36 52Q39 48 50 49L66 73Q73 83 73 98l-1 37c-.3 21-13 33-27 35-15-1-28-14-30-32l-1-38q0-16 8-28Z"
        fill={`url(#${paint})`} stroke="#22261e" strokeWidth="1.7" />
      <path d="M36 52Q39 48 50 49L66 73Q73 83 73 98l-1 37c-.3 21-13 33-27 35-15-1-28-14-30-32l-1-38q0-16 8-28Z" fill={`url(#${grain})`} />
      <g fill="none" strokeLinecap="round">
        <path d="M21 76q21 6 44-2m-49 53q27 6 55-2" stroke="#33382c" strokeWidth="1.4" opacity=".76" />
        <path d="M23 78q19 5 39-1m-44 52q26 5 48-1" stroke="#bab69b" opacity=".52" strokeWidth=".85" />
        <path d="M22 86q-2 11-1 26m1 22c1 9 5 16 10 20" stroke="#ded6b1" opacity=".5" strokeWidth="1.6" />
        <path d="M44 53q5-.6 7 1" stroke="#bbb79d" strokeWidth="1.1" />
        <path d="M40 163q12 3 21-9" stroke="#ad9e76" opacity=".57" />
      </g>
    </g>
  </svg>
}

function CameraJolt({ id }: { id: string }) {
  const svg = useRef<SVGSVGElement>(null)
  useEffect(() => { svg.current?.setCurrentTime(0) }, [])
  return <>
    <svg width="0" height="0" ref={svg} aria-hidden="true">
      <defs>
        <filter id={id} x="-4%" y="-4%" width="108%" height="108%" colorInterpolationFilters="sRGB">
          <feOffset>
            <animate attributeName="dx" values="0;-15;9;-6;4;-2;0" keyTimes="0;.09;.24;.42;.60;.8;1" dur="440ms" fill="freeze" />
            <animate attributeName="dy" values="0;8;-6;4;-2;1;0" keyTimes="0;.09;.24;.42;.60;.8;1" dur="440ms" fill="freeze" />
          </feOffset>
        </filter>
      </defs>
    </svg>
    <div className="bomb-camera-jolt" style={{ backdropFilter: `url("#${id}")` }} />
  </>
}

export function GooBomb({ point, phase, splash }: { point: Point; phase: GooBombPhase; splash?: GooSplash }) {
  const id = useId()
  useEffect(preloadSmoke, [])
  const burst = phase === 'burst'
  const duration = (splash ? gooBombTiming.stainEnd : gooBombTiming.end) - gooBombTiming.burst
  return <div className={'cinematic-bomb is-' + phase} role="img" aria-label={labels[phase]}
    style={{ left: point.x, top: point.y, '--bomb-x': point.x + 'px', '--bomb-y': point.y + 'px',
      '--fall-time': gooBombTiming.landing + 'ms',
      '--charge-time': gooBombTiming.burst - gooBombTiming.pull + 'ms',
      '--cloud-time': duration + 'ms' } as CSSProperties}>
    {burst && <CameraJolt id={id + '-jolt'} />}
    <div className="bomb-atmosphere" />
    {burst ? <>
      <div className="bomb-exposure" />
      <BlastCloud point={point} duration={duration} debris={splash?.bodies ?? 0} />
      <BlastFlow point={point} phase="burst" />
    </> : <>
      <div className="bomb-shadow" />
      {phase === 'landed' && <div className="bomb-impact-dust" />}
      {phase === 'charging' && <>
        <div className="bomb-inrush" />
        <BlastFlow point={point} phase="charging" />
      </>}
      <div className="bomb-prop-position"><BombProp id={id} /></div>
    </>}
  </div>
}
