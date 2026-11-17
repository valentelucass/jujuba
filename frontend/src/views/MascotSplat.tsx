import type { Impact, Point } from '../controllers/mascotMotion'

const directions = { top: 0, right: 90, bottom: 180, left: -90 }
const colors = ['#df2885', '#ff65af', '#f2459d']

type Drop = { x: number; y: number; width: number; height: number; rotation: number; color: string; delay: number }
export type Splat = Point & { remote?: string; id: number; edge: Impact['edge']; angle: number; width: number; duration: number; path: string; highlight: string; drops: Drop[] }

const vary = (min: number, max: number) => min + Math.random() * (max - min)

export function makeSplat(impact: Impact, size: number, id: number): Splat {
  const { x, y, edge, strength, slide } = impact
  const direction = directions[edge]
  const radians = direction * Math.PI / 180
  const bend = slide * (edge === 'right' || edge === 'bottom' ? -1 : 1)
  const center = size / 2
  const left = vary(19, 27) + strength * 17
  const right = vary(19, 27) + strength * 17
  const ridge = vary(12, 22) + strength * 14
  const foot = vary(2, 7) + strength * 5
  const lean = bend * 20 + vary(-10, 10)
  const count = 2 + Math.round(strength * 9 + vary(0, 2))
  const drops = Array.from({ length: count }, (_, index) => {
    const radius = vary(1.3, 3.8 + strength * 2.5)
    const dx = vary(-44, 44) + lean * .58
    return { x: dx, y: vary(13, 39 + 22 * strength), width: radius,
      height: radius * vary(.75, 2.1), rotation: -dx * .7,
      color: colors[index % colors.length], delay: Math.round(vary(5, 100)) }
  })
  return {
    id, edge, x: x + center + Math.sin(radians) * center,
    y: y + center - Math.cos(radians) * center,
    angle: direction, width: vary(55, 70) + strength * 72, duration: vary(1.5, 2.6) + strength * 1.7,
    path: `M-${left} ${foot} Q-${left - 7} ${foot - 11} ${lean} 2
      Q${right - 11} -1 ${right} ${foot} Q${right + 10} ${foot + 11} ${right - 13} ${foot + 12}
      C${lean + 14} ${ridge + vary(-1, 9)} ${lean - 6} ${foot + 9} -${left * .65} ${foot + 12}
      Q-${left + 11} ${foot + 13} -${left} ${foot}Z`,
    highlight: `M${lean - 11} ${foot + 5} Q${lean + 1} ${foot + 1} ${lean + vary(11, 24)} ${foot + 6}`,
    drops,
  }
}

export function MascotSplat({ mark, remove }: { mark: Splat; remove: () => void }) {
  return <svg className={'jujuba-splat' + (mark.remote ? ' is-remote' : '')} data-edge={mark.edge} aria-hidden="true" viewBox="-64 -64 128 128"
    style={{ left: mark.x, top: mark.y, width: mark.width, height: mark.width, animationDuration: `${mark.duration}s` }}
    onAnimationEnd={(event) => { if (event.target === event.currentTarget) remove() }}>
    <g transform={`rotate(${mark.angle})`}>
      <path d={mark.path} fill="#eb378f" />
      <path d={mark.highlight} fill="none" stroke="#ffb8db" strokeWidth="2.4" strokeLinecap="round" />
      {mark.drops.map(({ x, y, width, height, rotation, color, delay }, index) =>
        <g key={index} className="jujuba-splat-drop" style={{ animationDelay: delay + 'ms' }}>
          <ellipse cx={x} cy={y} rx={width} ry={height} fill={color} transform={`rotate(${rotation} ${x} ${y})`} />
        </g>)}
    </g>
  </svg>
}
