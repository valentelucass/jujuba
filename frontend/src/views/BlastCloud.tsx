import type { Point } from '../controllers/mascotMotion'
import { BlastCanvas } from './BlastCanvas'

const unit = (n: number) => Math.max(0, Math.min(1, n))
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const wave = (n: number) => Math.sin(n * 17.31 + 1.2)

function drawCloud(ctx: CanvasRenderingContext2D, width: number, height: number, point: Point, t: number, still: boolean, debris: number, smoke: HTMLImageElement) {
  const scale = Math.min(790, width * .87, height * .91)
  const inset = scale * .51
  const framedX = Math.min(width - inset, Math.max(inset, point.x))
  const framedY = Math.min(height - scale * .10, Math.max(scale * .92, point.y))
  const reframe = 1 - Math.exp(-t * 19)
  const x = mix(point.x, framedX, reframe)
  const y = mix(point.y, framedY, reframe)
  const rise = 1 - Math.exp(-t * 10)
  const spread = .17 + .83 * (1 - Math.exp(-t * 8))
  const fade = still ? .88 : unit((1 - t) / .27)
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(scale, scale)

  // Four volume renderings, each lit in ash, amber and flame, share one atlas.
  function puff(id: number, px: number, py: number, w: number, h: number, angle: number, heat: number, opacity = 1) {
    if (!smoke.naturalWidth || opacity <= 0) return
    const tile = smoke.naturalWidth / 4
    const tint = unit(heat) * 2
    const row = Math.floor(tint)
    const sourceX = (id % 4) * tile
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(angle)
    ctx.globalAlpha = opacity * fade
    ctx.drawImage(smoke, sourceX, row * tile, tile, tile, -w / 2, -h / 2, w, h)
    if (tint > row + .02 && row < 2) {
      ctx.globalAlpha *= tint - row
      ctx.drawImage(smoke, sourceX, (row + 1) * tile, tile, tile, -w / 2, -h / 2, w, h)
    }
    ctx.restore()
  }

  function glow(px: number, py: number, w: number, h: number, alpha: number) {
    if (alpha <= 0) return
    ctx.save()
    ctx.translate(px, py)
    ctx.scale(w, h)
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    gradient.addColorStop(0, '#fff5ad')
    gradient.addColorStop(.22, '#ffb041')
    gradient.addColorStop(.58, '#ec5d1859')
    gradient.addColorStop(1, '#e14a0b00')
    ctx.globalAlpha = alpha * fade
    ctx.fillStyle = gradient
    ctx.fillRect(-1, -1, 2, 2)
    ctx.restore()
  }

  const top = -.65 * rise - .045 * t
  const warmth = Math.max(0, 1 - t * 1.42)
  glow(0, top + .10 * rise, .49 * spread, .29 * spread, .64 * warmth)
  // The sides curl underneath the crest; the centre rises behind them.
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < 11; i++) {
      const u = (i - 5) / 5
      const n = 11 * layer + i
      const curl = Math.sin(t * 3 + i * 2.47)
      const px = (u * (.32 + .035 * layer) + .010 * curl) * spread
      const py = top + (.091 * u * u - .056 + layer * .075 + .012 * wave(n)) * rise
      const size = (.25 + .046 * wave(n + 11) - .055 * u * u + t * .03) * spread
      puff(n, px, py, size * 1.16, size, wave(n) * .8 + t * u * 1.1,
        warmth * (.58 + .27 * layer + .13 * wave(n)) + .07 * layer)
    }
  }

  // A narrowing column feeds the warmer underside of the cloud.
  for (let i = 0; i < 24; i++) {
    const u = i / 23
    const width = (.17 + .085 * u * u + .039 * Math.cos(u * 6.2) + .022 * wave(i)) * spread
    const px = (.020 * Math.sin(u * 7 - t * 3) + .036 * wave(i + 4)) * rise
    const py = mix(-.089 * spread, top * .89, u)
    puff(i + 23, px, py, width, width * (1.18 + .24 * u), wave(i) * .7 - t * .7,
      warmth * (.68 + .25 * wave(i + 3)) + .09 * (1 - u))
  }
  glow(-.014, top + .092 * rise, .20 * spread, .082 * spread, .77 * warmth * warmth)
  for (let i = 0; i < 13; i++) {
    const u = (i - 6) / 6
    const py = top + (.020 + .045 * u * u + .018 * wave(i + 4)) * rise
    const size = (.19 + .054 * wave(i + 4) + t * .048) * spread
    puff(i + 57, (.34 * u + .014 * Math.cos(i + t * 3)) * spread, py, size, size * .86,
      .5 * wave(i) + u * t * 1.3, .10 + warmth * (.60 + .31 * wave(i + 17)))
  }
  // Ground-hugging ash moves independently of the rising column.
  const extraDust = Math.min(15, debris * 2)
  for (let i = 0; i < 27 + extraDust; i++) {
    const u = Math.sin(i * 2.39996)
    const depth = (i % 11) / 10
    const dust = (.11 + .073 * (1 - Math.abs(u)) + .030 * wave(i)) * spread
    puff(i + 84, u * (.31 + .15 * depth + .045 * t) * spread, (-.02 + .057 * (depth - .5) + .021 * wave(i + 6)) * spread,
      dust * (1.52 + .26 * wave(i + 2)), dust * (.70 + .21 * wave(i)), wave(i + 1) * .20,
      warmth * (.14 + .36 * (1 - Math.abs(u))), .75 + .20 * depth)
  }

  if (!still) {
    glow(0, -.05 * rise, .29 * spread, .19 * spread, unit(1 - t * 4.8))
    const sparks = unit(1 - t * 1.8) * fade
    ctx.lineCap = 'round'
    ctx.lineWidth = .0017
    for (let i = 0; i < 45 && sparks > 0; i++) {
      const age = Math.max(0, t - i % 7 * .007)
      const vx = wave(i + 3) * (1.6 + .8 * wave(i + 7))
      const vy = -(.4 + 2.35 * Math.abs(wave(i + 19)))
      const px = vx * age
      const py = vy * age + 3.2 * age * age
      if (py > .017) continue
      ctx.strokeStyle = i % 3 ? '#ff9a4a' : '#ffe7a4'
      ctx.globalAlpha = sparks * (.6 + .34 * wave(i))
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(px - vx * .006, py - (vy + 6.4 * age) * .006)
      ctx.stroke()
    }
  }
  ctx.restore()
}

export function BlastCloud({ point, duration, debris }: { point: Point; duration: number; debris: number }) {
  return <BlastCanvas className="blast-cloud" duration={duration} draw={(ctx, width, height, ms, still, smoke) => {
    drawCloud(ctx, width, height, point, still ? .62 : unit(ms / duration), still, debris, smoke)
  }} />
}
