import { useEffect, useRef } from 'react'
import type { FlightBounds, FlightFrame, Point } from './mascotMotion'
import type { MascotImpulse } from '../models/flowMascot'

type Obstacle = { target: 'main' | 'clone'; point: Point }

export function useRemoteMascotCollisions({
  point, flight, held, obstacles, bounds, relocate, kick, hitPeer,
}: {
  point: Point | null; flight: FlightFrame | null; held: boolean; obstacles: Obstacle[]; bounds: FlightBounds
  relocate: (point: Point) => void; kick: (impulse: MascotImpulse, recoil: boolean, from: Point) => void
  hitPeer: (target: 'main' | 'clone', impulse: MascotImpulse) => void
}) {
  const previous = useRef<{ own: Point; peers: Obstacle[]; time: number } | null>(null)
  const lastHit = useRef(-Infinity)
  useEffect(() => {
    if (!point || !obstacles.length) {
      previous.current = null
      return
    }
    const now = performance.now()
    const before = previous.current
    previous.current = { own: point, peers: obstacles, time: now }
    const elapsed = Math.max(.016, (now - (before?.time ?? now)) / 1000)
    const velocity = flight?.velocity ?? (before ? {
      x: (point.x - before.own.x) / elapsed, y: (point.y - before.own.y) / elapsed,
    } : { x: 0, y: 0 })
    for (const obstacle of obstacles) {
      const dx = obstacle.point.x - point.x
      const dy = obstacle.point.y - point.y
      const gap = Math.hypot(dx, dy)
      if (gap >= 50) continue
      const direction = gap > .001 ? { x: dx / gap, y: dy / gap } : { x: 1, y: 0 }
      const push = 50 - gap
      const proposed = { x: point.x - direction.x * push, y: point.y - direction.y * push }
      const candidates = [
        proposed, { x: obstacle.point.x - 50, y: obstacle.point.y }, { x: obstacle.point.x + 50, y: obstacle.point.y },
        { x: obstacle.point.x, y: obstacle.point.y - 50 }, { x: obstacle.point.x, y: obstacle.point.y + 50 },
      ]
      const separated = candidates.find((at) => at.x >= bounds.left && at.x <= bounds.right && at.y >= bounds.top && at.y <= bounds.bottom)
      if (separated) relocate(separated)
      const priorPeer = before?.peers.find(({ target }) => target === obstacle.target)?.point ?? obstacle.point
      const remoteVelocity = { x: (obstacle.point.x - priorPeer.x) / elapsed, y: (obstacle.point.y - priorPeer.y) / elapsed }
      const approach = (velocity.x - remoteVelocity.x) * direction.x + (velocity.y - remoteVelocity.y) * direction.y
      if ((!flight && !held) || approach < 900 || now - lastHit.current < 420) continue
      lastHit.current = now
      const impulse = { direction, strength: Math.min(1250, Math.max(180, approach * .46)) }
      hitPeer(obstacle.target, impulse)
      if (!held) kick(impulse, true, separated ?? point)
    }
  })
}
