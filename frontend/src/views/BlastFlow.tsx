import type { Point } from '../controllers/mascotMotion'
import { gooBombTiming } from '../models/mascotScene'
import { BlastCanvas } from './BlastCanvas'

type Phase = 'charging' | 'burst'
const chargeTime = gooBombTiming.burst - gooBombTiming.pull
const stillTime = 150
const releaseTime = 1680
const tau = Math.PI * 2
const unit = (n: number) => Math.min(1, Math.max(0, n))
const fraction = (n: number) => n - Math.floor(n)

// Distribute starts across all four edges, including a trajectory towards each corner.
const grains = Array.from({ length: 156 }, (_, i) => {
  const along = i < 4 ? 0 : fraction(i * .61803399)
  const edge = i % 4
  return {
    x: edge === 0 ? along : edge === 1 ? 1 : edge === 2 ? 1 - along : 0,
    y: edge === 0 ? 0 : edge === 1 ? along : edge === 2 ? 1 : 1 - along,
    depth: fraction(i * .43127 + .17), offset: fraction(i * .821925 + .13),
    size: .8 + 2.7 * fraction(i * .5747), spin: (fraction(i * .26183) - .48) * 1.45,
    shard: fraction(i * .67149 + .12) < .17, smoke: fraction(i * .316831 + .09) < .14,
  }
})

function drawFlow(ctx: CanvasRenderingContext2D, width: number, height: number, at: Point,
  phase: Phase, ms: number, atlas: HTMLImageElement) {
  const pulling = phase === 'charging'
  const progress = unit(ms / (chargeTime - stillTime))
  if (pulling && progress >= 1) return
  const diagonal = Math.hypot(width, height)
  const farthest = Math.hypot(Math.max(at.x, width - at.x), Math.max(at.y, height - at.y))
  const charge = progress * progress
  const entry = unit(ms / 180)
  const scale = Math.max(.65, Math.min(1.3, diagonal / 1100))
  ctx.save()
  ctx.translate(at.x, at.y)
  ctx.lineCap = 'round'
  if (!pulling && ms < 940) {
    const t = unit(ms / 850)
    const r = 6 + (farthest + 65) * (1 - (1 - t) ** 1.32)
    const thickness = Math.min(r * .7, (10 + t * 19) * scale)
    const band = ctx.createRadialGradient(0, 0, r - thickness, 0, 0, r + 3)
    band.addColorStop(0, '#5e493200')
    band.addColorStop(.44, '#3c352d55')
    band.addColorStop(.76, '#f2cca644')
    band.addColorStop(.93, '#ffefbbdb')
    band.addColorStop(1, '#e9d9c500')
    ctx.strokeStyle = band
    ctx.lineWidth = thickness + 3
    ctx.globalAlpha = Math.min(1, (940 - ms) / 130)
    ctx.beginPath()
    ctx.arc(0, 0, r - thickness * .5 + 1.5, 0, tau)
    ctx.stroke()
  }
  for (let i = 0; i < grains.length; i++) {
    const g = grains[i]
    const dx = (width + 48) * g.x - 24 - at.x
    const dy = (height + 48) * g.y - 24 - at.y
    const travel = pulling ? fraction(g.offset + (progress * .94 + charge * 2.52) * (.72 + g.depth * .64))
      : (ms - g.offset * 84) / (625 + g.depth * 960)
    if (travel <= 0 || travel >= 1) continue
    const trail = pulling ? .025 + travel * (.08 + .115 * charge) : .030 + .078 * (1 - travel)
    const tail = Math.max(0, travel - trail)
    const r = pulling ? 1 - travel ** 1.29 : (1 - (1 - travel) ** 1.63) * 1.11
    const r0 = pulling ? 1 - tail ** 1.29 : (1 - (1 - tail) ** 1.63) * 1.11
    const twist = .46 + g.depth * .5 + g.spin * .28
    const angle = pulling ? twist * travel * (1 + charge) : g.spin * .057 * travel
    const a0 = pulling ? twist * tail * (1 + charge) : g.spin * .057 * tail
    const x = r * (dx * Math.cos(angle) - dy * Math.sin(angle))
    const y = r * (dy * Math.cos(angle) + dx * Math.sin(angle))
    const tx = r0 * (dx * Math.cos(a0) - dy * Math.sin(a0))
    const ty = r0 * (dy * Math.cos(a0) + dx * Math.sin(a0))
    const opacity = pulling ? entry * (.39 + .50 * charge) * Math.min(1, travel * 8, (1 - travel) * 10)
      : unit((1 - travel) * 4) * (.72 + g.depth * .26)
    if (opacity <= 0) continue
    if (g.smoke && atlas.naturalWidth) {
      const tile = atlas.naturalWidth / 4
      const size = (pulling ? 15 + 62 * r : 12 + 46 * r) * scale
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(Math.atan2(y - ty, x - tx))
      ctx.globalAlpha = opacity * (pulling ? .64 : .54)
      const breadth = .36 + g.depth * .36
      ctx.drawImage(atlas, (i % 4) * tile, 0, tile, tile, -size, -size * breadth / 2, size * 1.3, size * breadth)
      ctx.restore()
    }
    const color = g.shard ? '#b3a993' : g.depth > .62 ? '#ffb366' : '#f3d8aa'
    const streak = ctx.createLinearGradient(tx, ty, x, y)
    streak.addColorStop(0, '#b9977800')
    streak.addColorStop(1, color)
    ctx.globalAlpha = opacity * (g.shard ? .84 : .68)
    ctx.strokeStyle = streak
    ctx.lineWidth = g.size * scale * (g.shard ? 1.18 : .70)
    ctx.beginPath()
    ctx.moveTo(tx, ty)
    if (pulling) {
      const bend = .06 + charge * .10
      ctx.quadraticCurveTo((tx + x) / 2 - (y - ty) * bend, (ty + y) / 2 + (x - tx) * bend, x, y)
    } else {
      ctx.lineTo(x, y)
    }
    ctx.stroke()
    if (g.shard) {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(g.spin * 5 + travel * (pulling ? 7 : 12))
      const d = scale * (g.size + 1.3)
      ctx.fillStyle = pulling ? '#b1a38b' : '#deaa72'
      ctx.beginPath()
      ctx.moveTo(-d * 1.65, -.28 * d)
      ctx.lineTo(.65 * d, -d)
      ctx.lineTo(d, .35 * d)
      ctx.lineTo(-.55 * d, .75 * d)
      ctx.fill()
      ctx.restore()
    }
  }
  ctx.restore()
}

export function BlastFlow({ point, phase }: { point: Point; phase: Phase }) {
  const duration = phase === 'charging' ? chargeTime - stillTime : releaseTime
  return <BlastCanvas className="blast-flow" duration={duration} draw={(ctx, width, height, ms, still, smoke) => {
    if (!still && ms < duration) drawFlow(ctx, width, height, point, phase, ms, smoke)
  }} />
}
