import { useId, type CSSProperties, type Ref } from 'react'
import type { Point } from '../controllers/mascotMotion'

export function ToyBow({ anchor, direction, stretch, boost, power, drawn, elementRef }: {
  anchor: Point; direction: Point; stretch: number; boost: number; power: number; drawn: boolean; elementRef?: Ref<SVGGElement>
}) {
  const id = useId()
  const pull = stretch * 205
  const angle = (vector: Point) => Math.atan2(vector.y, vector.x) * 180 / Math.PI
  return <>
      <defs>
        <linearGradient id={id + '-limb'} x1="0" y1="-50" x2="0" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffe6a3" /><stop offset=".27" stopColor="#e9a13a" />
          <stop offset=".5" stopColor="#aa5e29" /><stop offset=".76" stopColor="#f3bd58" /><stop offset="1" stopColor="#ffdf8e" />
        </linearGradient>
      </defs>
        <g ref={elementRef} className={`mascot-bow-rig${drawn ? ' is-drawn' : ''}${boost > .2 ? ' is-boosted' : ''}`}
          data-stretch={stretch.toFixed(3)} data-boost={boost.toFixed(3)} data-power={power.toFixed(3)}
          style={{ '--bow-shake': `${.15 + power * .9}px`, '--bow-tremble': `${135 - power * 30}ms` } as CSSProperties}
          transform={`translate(${anchor.x} ${anchor.y}) rotate(${angle(direction)}) scale(${1.05 + stretch * .16})`}>
          <g className="mascot-bow-body">
            <path className="mascot-bow-aura" d={`M${-8 - stretch * 18} -51C-11-37 23-30 15-8L15 8C23 30-11 37 ${-8 - stretch * 18} 51`} />
            <path className="mascot-bow-limbs" stroke={`url(#${id}-limb)`}
              d={`M${-8 - stretch * 18} -51C-11-37 23-30 15-8L15 8C23 30-11 37 ${-8 - stretch * 18} 51`} />
            <path className="mascot-bow-inlay" d="M2-36Q12-31 14-22M14 22Q12 31 2 36" />
            <path className="mascot-bow-string" d={`M${-8 - stretch * 18} -51 L${-pull - 8} 0 L${-8 - stretch * 18} 51`} />
            <rect className="mascot-bow-grip" x="9" y="-10" width="12" height="20" rx="4" />
            <path className="mascot-bow-grip-wrap" d="m10-6 10 3m-10 3 10 3m-10 3 10 3" />
            <circle className="mascot-bow-gem" cx="15" cy="-15" r="3" />
            {drawn && <g className="mascot-bow-nocked" transform={`translate(${-pull - 8} 0) scale(${.9 + power * .5})`}>
              <path className="mascot-bow-shaft" d={`M0 0H${34 + pull / (1 + power * .5)}`} />
              <path className="mascot-bow-fletching" d="M-12-6 2-2 6 0 2 2-12 6-8 0Z" />
              <path className="mascot-bow-head" d={`M${34 + pull / (1 + power * .5)}-6l14 6-14 6 3-6Z`} />
            </g>}
          </g>
        </g>
  </>
}
