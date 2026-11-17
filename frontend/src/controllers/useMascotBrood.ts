import { useEffect, useRef, useState } from 'react'
import { animateThrow, type FlightBounds, type FlightFrame, type Point } from './mascotMotion'
import type { MascotImpulse } from '../models/flowMascot'

export type Hug = { key: string; point: Point }
export type Offspring = { id: number; x: number; phase: 'egg' | 'young' | 'popping'; flight: FlightFrame | null }
const limit = 15

function keepInBounds(x: number, area: FlightBounds) {
  return Math.max(area.left, Math.min(area.right, x))
}

function birthSpot(near: number, ordinal: number, siblings: Offspring[], area: FlightBounds) {
  const spacing = Math.min(40, (area.right - area.left) / limit)
  const inward = near < (area.left + area.right) / 2 ? 1 : -1
  const preferred = keepInBounds(near + inward * (55 + ordinal * spacing), area)
  for (let step = 0; step <= limit; step++) {
    const offsets = step ? [inward * step, -inward * step] : [0]
    for (const offset of offsets) {
      const x = keepInBounds(preferred + spacing * offset, area)
      if (siblings.every((child) => Math.abs(child.x - x) >= spacing - .1)) return x
    }
  }
  return preferred
}

export function useEggSchedule(hug: Hug | null, lay: (near: Point, ordinal: number) => void) {
  const latest = useRef({ hug, lay })
  latest.current = { hug, lay }
  const key = hug?.key
  useEffect(() => {
    if (!key) return
    const timers = [3200, 4500, 5800].map((delay, ordinal) => window.setTimeout(() => {
      const { hug: current, lay: drop } = latest.current
      if (current?.key === key) drop(current.point, ordinal)
    }, delay))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [key])
}

export function useMascotBrood(area: FlightBounds) {
  const [children, setChildren] = useState<Offspring[]>([])
  const nextId = useRef(0)
  const bounds = useRef(area)
  const animations = useRef(new Map<number, () => void>())
  bounds.current = area

  useEffect(() => {
    const live = animations.current
    return () => {
      live.forEach((stop) => stop())
      live.clear()
    }
  }, [])

  function lay(near: Point, ordinal: number) {
    const id = ++nextId.current
    setChildren((previous) => previous.length < limit ? [...previous, {
      id, x: birthSpot(near.x, ordinal, previous, bounds.current), phase: 'egg', flight: null,
    }] : previous)
  }

  function hatch(id: number) {
    setChildren((previous) => previous.map((child) => child.id === id && child.phase === 'egg' ? { ...child, phase: 'young' } : child))
  }

  function position(child: Offspring): Point {
    return child.flight ?? { x: keepInBounds(child.x, area), y: area.bottom }
  }

  function bump(id: number, impulse: MascotImpulse) {
    const child = children.find((entry) => entry.id === id)
    if (child?.phase !== 'young' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    animations.current.get(id)?.()
    const from = position(child)
    const strength = impulse.strength * .78
    const stop = animateThrow(from, {
      x: impulse.direction.x * strength,
      y: Math.min(-85, impulse.direction.y * strength - 165),
    }, () => bounds.current, (frame) => {
      setChildren((previous) => previous.map((entry) => entry.id === id ? { ...entry, flight: frame } : entry))
    }, () => {}, (rest) => {
      animations.current.delete(id)
      setChildren((previous) => previous.map((entry) => entry.id === id ? { ...entry, x: rest.x, flight: null } : entry))
    })
    animations.current.set(id, stop)
  }

  function pop(id: number) {
    animations.current.get(id)?.()
    animations.current.delete(id)
    setChildren((previous) => previous.map((child) => child.id === id && child.phase === 'young' ? { ...child, phase: 'popping' } : child))
  }

  function remove(id: number) {
    setChildren((previous) => previous.filter((child) => child.id !== id))
  }

  return { children, lay, hatch, position, bump, pop, remove }
}
