type PointerSample = { x: number; y: number; time: number }
export type ImpactEdge = 'top' | 'bottom'
export type FlightFrame = { y: number; squash: number; edge: ImpactEdge }

export function verticalFlick(samples: PointerSample[], release: PointerSample) {
  const last = samples.at(-1)
  const first = samples.find((sample) => release.time - sample.time <= 115 && release.time > sample.time)
  if (!last || !first || release.time - last.time > 85) return 0

  const x = release.x - first.x
  const y = release.y - first.y
  const velocity = 1000 * y / Math.max(16, release.time - first.time)
  if (Math.abs(y) < 34 || Math.abs(y) < Math.abs(x) * 1.45 || Math.abs(velocity) < 850) return 0
  return Math.sign(velocity) * Math.min(2100, Math.max(1120, Math.abs(velocity)))
}

export function animateThrow(
  y: number, velocity: number, top: number, bottom: number,
  onFrame: (frame: FlightFrame) => void,
  onImpact: (edge: ImpactEdge, strength: number) => void,
  onFinish: (y: number, hit: boolean) => void,
) {
  const gravity = 720
  const started = performance.now()
  let previous = started
  let edge: ImpactEdge = 'bottom'
  let lastImpact = -Infinity
  let strength = 0
  let hits = 0
  let request = 0

  function tick(now: number) {
    const dt = Math.min(.032, (now - previous) / 1000)
    previous = now
    velocity += gravity * dt
    y += velocity * dt
    if (y <= top || y >= bottom) {
      edge = y <= top ? 'top' : 'bottom'
      y = edge === 'top' ? top : bottom
      const speed = Math.abs(velocity)
      velocity = -velocity * (edge === 'top' ? .54 : .49)
      if (speed >= 205) {
        hits += 1
        lastImpact = now
        strength = Math.min(1, speed / 1450)
        onImpact(edge, strength)
      } else if (edge === 'bottom') {
        onFinish(y, hits > 0)
        return
      }
    }

    const squash = Math.max(0, 1 - (now - lastImpact) / 165) * strength
    onFrame({ y, squash, edge })
    if (now - started > 2450) {
      onFinish(y, hits > 0)
      return
    }
    request = requestAnimationFrame(tick)
  }

  request = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(request)
}
