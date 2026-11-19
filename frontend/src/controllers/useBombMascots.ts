import { useEffect, useRef, useState } from 'react'
import type { FlightBounds, Point } from './mascotMotion'

export type BombFlight = { active: () => boolean; restore: (position: Point) => void }
type Actor = {
  point: Point
  place: (position: Point) => void
  releaseGrip: () => void
  launch: (from: Point, velocity: Point) => BombFlight
}
type Actors = { main: Actor; clone: Actor | null; bounds: FlightBounds }
type Track = { key: 'main' | 'clone'; origin: Point }
type Formation = { seat: number; participants: number }
type Pull = { center: Point; formation: Formation; tracks: Track[]; gentle: boolean; frame: number }
const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v))

function landingSlot(bomb: Point, bounds: FlightBounds, paired: boolean, clone: boolean) {
  const spread = paired ? Math.min(9, (bounds.right - bounds.left) / 2) : 0
  const x = clamp(bomb.x - 33, bounds.left + spread, bounds.right - spread)
  return { x: x + (clone ? spread : -spread), y: clamp(bomb.y - 33, bounds.top, bounds.bottom) }
}

function ejection(from: Point, bounds: FlightBounds, track: Track, paired: boolean, pull: Pull) {
  const width = bounds.right - bounds.left
  const height = bounds.bottom - bounds.top
  const relativeX = (pull.center.x - 33 - bounds.left) / Math.max(1, width)
  const relativeY = (from.y - bounds.top) / Math.max(1, height)
  const clone = track.key === 'clone'
  const outward = track.origin.x - from.x
  const { seat, participants } = pull.formation
  const shared = participants > 1
  // Each player's main mascot has its own sector. Its clone fills the gap to the next player's sector.
  const angle = -.82 * Math.PI + (seat * 2 + (clone ? 1 : 0)) * Math.PI / participants
  const horizontalEdge = relativeX < .2 ? 1 : relativeX > .8 ? -1 : 0
  const verticalEdge = relativeY < .24 ? 1 : relativeY > .72 ? -1 : 0
  const side = horizontalEdge || (shared ? Math.sign(Math.cos(angle)) : paired ? (clone ? 1 : -1) : Math.sign(outward) || -1)
  const lift = verticalEdge || (shared ? Math.sign(Math.sin(angle)) : clone ? 1 : -1)
  let steepness = shared ? Math.abs(Math.sin(angle)) : clone ? .95 : .22
  if (horizontalEdge && paired) steepness = clone !== (horizontalEdge === 1) ? .98 : .14
  // Opposite sectors reflected off a corner still leave on different inclines.
  if (shared && (horizontalEdge || verticalEdge)) steepness = (steepness + seat * .37) % 1
  const horizontal = clamp(width * (2.55 - steepness * 1.12), 685, 2800)
  const vertical = clamp(Math.sqrt(2 * 1200 * height) * (.65 + steepness * .74), 520, 1900)
  return { x: side * horizontal, y: lift * vertical }
}

export function useBombMascots(actors: Actors) {
  const live = useRef(actors)
  live.current = actors
  const gathering = useRef<Pull | null>(null)
  const flights = useRef<{ flight: BombFlight; origin: Point }[]>([])
  const [pulling, setPulling] = useState(false)

  function start(center: Point, duration: number, formation: Formation) {
    const tracks: Track[] = [{ key: 'main', origin: { ...live.current.main.point } }]
    if (live.current.clone) tracks.push({ key: 'clone', origin: { ...live.current.clone.point } })
    const pull: Pull = { center, formation, tracks, gentle: matchMedia('(prefers-reduced-motion: reduce)').matches, frame: 0 }
    gathering.current = pull
    flights.current = []
    if (pull.gentle) return
    setPulling(true)
    for (const { key, origin } of tracks) {
      live.current[key]?.releaseGrip()
      live.current[key]?.place(origin)
    }
    const started = performance.now()
    function draw(now: number) {
      if (gathering.current !== pull) return
      const { bounds } = live.current
      const time = Math.min(1, (now - started) / Math.max(1, duration - 130))
      const eased = time ** 1.85
      const arc = Math.sin(Math.PI * time)
      const paired = !!live.current.clone && tracks.length > 1
      for (const { key, origin } of tracks) {
        const actor = live.current[key]
        if (!actor) continue
        const clone = key === 'clone'
        const goal = landingSlot(center, bounds, paired, clone)
        // The arc is visible even when the blast is aimed directly at a mascot.
        const turn = time * Math.PI * 1.65 + (clone ? Math.PI : 0)
        const inwardX = origin.x < (bounds.right + bounds.left) / 2 ? 1 : -1
        const inwardY = origin.y < (bounds.top + bounds.bottom) / 2 ? 1 : -1
        const bendX = arc * Math.cos(turn) * inwardX * Math.min(100, (bounds.right - bounds.left) * .16)
        const bendY = arc * Math.sin(turn) * inwardY * Math.min(84, (bounds.bottom - bounds.top) * .16)
        actor.place({
          x: clamp(origin.x + (goal.x - origin.x) * eased + bendX, bounds.left, bounds.right),
          y: clamp(origin.y + (goal.y - origin.y) * eased + bendY, bounds.top, bounds.bottom),
        })
      }
      if (time < 1) pull.frame = requestAnimationFrame(draw)
    }
    pull.frame = requestAnimationFrame(draw)
  }

  function burst() {
    const pull = gathering.current
    if (!pull) return
    gathering.current = null
    cancelAnimationFrame(pull.frame)
    setPulling(false)
    if (pull.gentle || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (!pull.gentle) for (const track of pull.tracks) live.current[track.key]?.place(track.origin)
      return
    }
    const { bounds } = live.current
    const paired = !!live.current.clone && pull.tracks.length > 1
    for (const track of pull.tracks) {
      const actor = live.current[track.key]
      if (!actor) continue
      const from = landingSlot(pull.center, bounds, paired, track.key === 'clone')
      const flight = actor.launch(from, ejection(from, bounds, track, paired, pull))
      flights.current.push({ flight, origin: track.origin })
    }
  }

  function cancel() {
    const pull = gathering.current
    gathering.current = null
    if (pull) {
      cancelAnimationFrame(pull.frame)
      if (!pull.gentle) for (const track of pull.tracks) live.current[track.key]?.place(track.origin)
    }
    for (const { flight, origin } of flights.current) flight.restore(origin)
    flights.current = []
    setPulling(false)
  }

  useEffect(() => () => {
    if (gathering.current) cancelAnimationFrame(gathering.current.frame)
    gathering.current = null
    flights.current = []
    // The launcher and clone own their flight loops and dispose them on unmount.
  }, [])
  const moving = pulling || flights.current.some(({ flight }) => flight.active())
  return { start, burst, cancel, pulling, moving }
}
