import type { CSSProperties } from 'react'
import type { JellyEffect } from '../controllers/useJellyPlay'
import './jellyEffects.css'

export function JellyEffects({ effects }: { effects: JellyEffect[] }) {
  return <>{effects.map((effect) => effect.kind === 'candies' ?
    <span key={effect.id} className="jelly-candies" aria-hidden="true" style={{ left: effect.x, top: effect.y }}>
      {effect.pieces.map((piece, index) => <i key={index} style={{
        width: piece.size, height: piece.size * (index % 3 === 0 ? 1 : 1.8), backgroundColor: piece.color,
        '--drift': piece.dx + 'px', '--apex-x': piece.dx * .48 + 'px', '--rise': -piece.rise + 'px',
        '--fall': piece.fall + 'px', '--spin': piece.spin + 'deg', animationDelay: (index % 4) * 18 + 'ms',
      } as CSSProperties} />)}
    </span> :
    <svg key={effect.id} className="jelly-stamp" aria-hidden="true" viewBox="0 0 36 36"
      style={{ left: effect.x, top: effect.y, width: effect.size, height: effect.size, color: effect.tint,
        transform: `translate(-50%, -50%) rotate(${effect.angle}deg) scaleY(${effect.squash})` }}>
      <path fill="currentColor" d="M6 20c0-4 2-10 5-13 2-1 4 0 7 0s6-1 8 2c2 3 4 9 4 13 0 4-3 5-6 5l-5 2-6-2c-5 1-8-2-7-7Z" />
      <g fill="#ffdaeb">
        <ellipse cx="13" cy="16" rx="1.6" ry="2" /><ellipse cx="22" cy="16" rx="1.5" ry="1.8" />
        <path d="M14 20q3 2 7-1-2 6-7 1Z" /><path opacity=".7" d="M9 14q1-5 4-5l3 .4q-4 1-7 4.6Z" />
      </g>
      <g fill="currentColor"><ellipse cx="4.2" cy="24" rx="1.8" ry="1.2" /><circle cx="32" cy="23" r="1.1" /></g>
    </svg>)}</>
}
