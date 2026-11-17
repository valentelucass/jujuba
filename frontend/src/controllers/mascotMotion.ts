export type Point = { x: number; y: number }
export type PointerSample = Point & { time: number }
export type ImpactEdge = 'top' | 'right' | 'bottom' | 'left'
export type FlightBounds = { left: number; top: number; right: number; bottom: number }
export type FlightFrame = Point & { velocity: Point; squash: number; edge: ImpactEdge }
export type Impact = Point & { edge: ImpactEdge; strength: number; slide: number }

export function separateMascots(a: Point, b: Point, bounds: FlightBounds, fallback: Point = { x: 1, y: 0 }) {
  const first = { ...a }
  const second = { ...b }
  for (let pass = 0; pass < 4; pass++) {
    const dx = second.x - first.x
    const dy = second.y - first.y
    const distance = Math.hypot(dx, dy)
    if (distance >= 49.5) break
    const nx = distance > .001 ? dx / distance : fallback.x
    const ny = distance > .001 ? dy / distance : fallback.y
    const push = (50 - distance) / 2
    const before = Math.hypot(first.x - second.x, first.y - second.y)
    first.x = Math.max(bounds.left, Math.min(bounds.right, first.x - nx * push))
    first.y = Math.max(bounds.top, Math.min(bounds.bottom, first.y - ny * push))
    second.x = Math.max(bounds.left, Math.min(bounds.right, second.x + nx * push))
    second.y = Math.max(bounds.top, Math.min(bounds.bottom, second.y + ny * push))
    if (Math.hypot(first.x - second.x, first.y - second.y) <= before + .01) {
      first.y = Math.max(bounds.top, first.y - push)
      second.y = Math.min(bounds.bottom, second.y + push)
    }
  }
  return { first, second }
}

export function throwVelocity(samples: PointerSample[], release: PointerSample): Point | null {
  const last = samples.at(-1)
  if (!last || release.time - last.time > 75) return null
  const first = samples.find((sample) => release.time > sample.time && release.time - sample.time <= 95)
  if (!first) return null

  const dx = release.x - first.x
  const dy = release.y - first.y
  const distance = Math.hypot(dx, dy)
  const speed = 1000 * distance / Math.max(14, release.time - first.time)
  if (distance < 20 || speed < 680) return null
  const multiplier = Math.min(3500, speed * 1.15) / distance
  return { x: dx * multiplier, y: dy * multiplier }
}

const gravity = 1200
const floorBounce = 0.63
const wallBounce = 0.78
const stepSize = 1 / 200
const impactAnimation = 190

export function animateThrow(
  start: Point, initial: Point, bounds: () => FlightBounds,
  onFrame: (frame: FlightFrame) => void,
  onImpact: (impact: Impact) => void,
  onFinish: (rest: Point) => void,
) {
  let { x, y } = start
  let { x: vx, y: vy } = initial
  let onFloor = false
  let lastTime = performance.now()
  let lastImpact = -Infinity
  let edge: ImpactEdge = 'bottom'
  let squashLimit = 0
  let request = 0

  function tick(now: number) {
    const area = bounds()
    const elapsed = Math.max(0, Math.min(.065, (now - lastTime) / 1000))
    lastTime = now
    x = Math.max(area.left, Math.min(area.right, x))
    y = onFloor ? area.bottom : Math.max(area.top, Math.min(area.bottom, y))
    for (let remaining = elapsed; remaining > 0; remaining -= stepSize) {
      step(Math.min(stepSize, remaining), area, now)
    }
    const squash = Math.max(0, 1 - (now - lastImpact) / impactAnimation) * squashLimit
    onFrame({ x, y, velocity: { x: vx, y: vy }, squash, edge })
    if (onFloor && Math.abs(vx) < 15 && squash < .01) {
      onFinish({ x, y: area.bottom })
    } else {
      request = requestAnimationFrame(tick)
    }
  }

  function step(dt: number, area: FlightBounds, now: number) {
    // Resolve the first surface crossed within each step, including the approach to a corner.
    for (let collisions = 0; dt > 0.00001 && collisions < 3; collisions++) {
      const ay = onFloor ? 0 : gravity
      const nextX = x + vx * dt
      const nextY = y + vy * dt + ay * dt * dt / 2
      const wall = nextX < area.left ? 'left' : nextX > area.right ? 'right' : null
      const limitX = wall === 'left' ? area.left : area.right
      const wallTime = wall ? (limitX - x) / (nextX - x) : Infinity
      const surface = nextY < area.top ? 'top' : nextY >= area.bottom && !onFloor ? 'bottom' : null
      const limitY = surface === 'top' ? area.top : area.bottom
      const surfaceTime = surface && nextY !== y ? (limitY - y) / (nextY - y) : Infinity
      const fraction = Math.min(1, wallTime, surfaceTime)
      const advance = dt * fraction
      x += (nextX - x) * fraction
      y += (nextY - y) * fraction
      vy += ay * advance
      if (onFloor) vx = Math.sign(vx) * Math.max(0, Math.abs(vx) - 850 * advance)
      else vx *= Math.exp(-.13 * advance)
      dt -= advance

      if (wall && wallTime <= surfaceTime) {
        x = limitX
        impact(wall, vx, vy, now)
        vx *= -wallBounce
        vy *= .94
      } else if (surface && surfaceTime <= 1) {
        y = limitY
        impact(surface, vy, vx, now)
        onFloor = surface === 'bottom' && Math.abs(vy) < 155
        vy = onFloor ? 0 : -vy * (surface === 'bottom' ? floorBounce : .7)
        vx *= .9
      }
    }
  }

  function impact(surface: ImpactEdge, normal: number, tangential: number, now: number) {
    const speed = Math.abs(normal)
    if (speed < 175) return
    const strength = Math.min(1, speed / 2300)
    edge = surface
    lastImpact = now
    squashLimit = .22 + strength * .78
    onImpact({ x, y, edge, strength, slide: Math.max(-1, Math.min(1, tangential / 1200)) })
  }

  request = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(request)
}
