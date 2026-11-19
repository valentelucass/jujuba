import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { animateThrow, throwVelocity, type FlightBounds, type FlightFrame, type Impact, type Point, type PointerSample } from './mascotMotion'
import type { MascotImpulse } from '../models/flowMascot'

export function useMascotClone(bounds: FlightBounds, onImpact: (mark: Impact) => void,
  onLaunch: (sound: 'throw' | 'slimeKick', speed: number) => void) {
  const [position, setPosition] = useState<Point | null>(null)
  const [held, setHeld] = useState(false)
  const [flight, setFlight] = useState<FlightFrame | null>(null)
  const cancel = useRef<(() => void) | null>(null)
  const drag = useRef<{ id: number; button: HTMLButtonElement; offset: Point; samples: PointerSample[] } | null>(null)
  const limits = useRef(bounds)
  limits.current = bounds
  const clamp = (point: Point): Point => ({
    x: Math.max(bounds.left, Math.min(bounds.right, point.x)),
    y: Math.max(bounds.top, Math.min(bounds.bottom, point.y)),
  })
  const point = flight ?? (position && clamp(position))
  useEffect(() => () => cancel.current?.(), [])

  function throwClone(from: Point, velocity: Point, sound?: 'throw' | 'slimeKick') {
    if (sound) onLaunch(sound, Math.hypot(velocity.x, velocity.y))
    cancel.current?.()
    setFlight({ ...from, velocity, squash: 0, edge: 'bottom' })
    const cancelThisFlight = animateThrow(from, velocity, () => limits.current, setFlight, (impact) => {
      if (sound) onImpact(impact)
    }, (rest) => {
      cancel.current = null
      setFlight(null)
      setPosition(rest)
    })
    cancel.current = cancelThisFlight
    const active = () => cancel.current === cancelThisFlight
    return { active, restore: (at: Point) => { if (active()) relocate(at) } }
  }

  function boost(impulse: MascotImpulse, recoil = false, from?: Point) {
    if (!point || drag.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const sign = recoil ? -.88 : 1
    throwClone(from ?? point, { x: impulse.direction.x * impulse.strength * sign, y: impulse.direction.y * impulse.strength * sign - 180 }, 'slimeKick')
  }

  function keepOrRemove(anchor: Point) {
    if (point) {
      cancel.current?.()
      cancel.current = null
      setFlight(null)
      setPosition(null)
      setHeld(false)
      drag.current = null
      return
    }
    const offset = anchor.x > (bounds.left + bounds.right) / 2 ? -105 : 105
    setPosition(clamp({ x: anchor.x + offset, y: anchor.y }))
  }

  function grab(event: PointerEvent<HTMLButtonElement>) {
    if (!point || event.button !== 0 || !event.isPrimary) return
    cancel.current?.()
    cancel.current = null
    setFlight(null)
    setPosition(point)
    drag.current = { id: event.pointerId, button: event.currentTarget, offset: { x: event.clientX - point.x, y: event.clientY - point.y },
      samples: [{ x: event.clientX, y: event.clientY, time: event.timeStamp }] }
    event.currentTarget.setPointerCapture(event.pointerId)
    setHeld(true)
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current
    if (!active || active.id !== event.pointerId) return
    active.samples = [...active.samples.slice(-31), { x: event.clientX, y: event.clientY, time: event.timeStamp }]
    setPosition(clamp({ x: event.clientX - active.offset.x, y: event.clientY - active.offset.y }))
  }

  function release(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current
    if (!active || active.id !== event.pointerId) return
    drag.current = null
    setHeld(false)
    if (event.type !== 'pointerup' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const velocity = throwVelocity(active.samples, { x: event.clientX, y: event.clientY, time: event.timeStamp })
    if (velocity) throwClone(clamp({ x: event.clientX - active.offset.x, y: event.clientY - active.offset.y }), velocity, 'throw')
  }

  function nudge(x: number, y: number) {
    if (point && !flight) setPosition(clamp({ x: point.x + x, y: point.y + y }))
  }

  function relocate(next: Point) {
    cancel.current?.()
    cancel.current = null
    setFlight(null)
    setPosition(clamp(next))
  }

  function releaseGrip() {
    const grip = drag.current
    drag.current = null
    setHeld(false)
    if (grip?.button.hasPointerCapture(grip.id)) grip.button.releasePointerCapture(grip.id)
  }
  return { point, flight, held, grab, move, release, keepOrRemove, boost, nudge, relocate, releaseGrip,
    launch: (from: Point, velocity: Point) => throwClone(from, velocity) }
}
