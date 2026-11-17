import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { throwVelocity, type FlightBounds, type FlightFrame, type Impact, type ImpactEdge, type Point, type PointerSample } from './mascotMotion'
import type { MascotImpulse } from '../models/flowMascot'

export type Hug = { key: string; point: Point }
export type Offspring = { id: number; x: number; phase: 'egg' | 'young' | 'popping'; flight: FlightFrame | null; held?: boolean }
export type BroodActor = { id: string; point: Point; active: boolean }
type Body = { x: number; y: number; vx: number; vy: number; squash: number; edge: ImpactEdge; lastImpact: number; held: boolean }
const limit = 100
const radius = 17
const neighbours = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 0], [0, 1], [1, -1], [1, 0], [1, 1]]

function constrain(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function birthSpot(near: number, ordinal: number, bodies: Map<number, Body>, area: FlightBounds): Point {
  const spacing = 36
  const inward = near < (area.left + area.right) / 2 ? 1 : -1
  const preferred = constrain(near + inward * (55 + ordinal * spacing), area.left, area.right)
  const columns = Math.ceil((area.right - area.left) / spacing) + 1
  const siblings = [...bodies.values()]
  for (let row = 0; row <= Math.ceil(limit / columns); row++) {
    const y = Math.max(area.top, area.bottom - row * spacing)
    for (let step = 0; step <= columns; step++) {
      const offsets = step ? [inward * step, -inward * step] : [0]
      for (const offset of offsets) {
        const x = constrain(preferred + spacing * offset, area.left, area.right)
        if (siblings.every((body) => Math.hypot(body.x - x, body.y - y) >= spacing - 1)) return { x, y }
      }
    }
  }
  return { x: preferred, y: area.bottom - 72 }
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

export function useMascotBrood(area: FlightBounds, onImpact: (mark: Impact) => void) {
  const [children, setChildren] = useState<Offspring[]>([])
  const live = useRef(children)
  const nextId = useRef(0)
  const scene = useRef({ area, onImpact, actors: [] as BroodActor[] })
  scene.current = { area, onImpact, actors: scene.current.actors }
  const bodies = useRef(new Map<number, Body>())
  const drag = useRef<{ id: number; pointer: number; offset: Point; moved: boolean; origin: Point; samples: PointerSample[] } | null>(null)
  const animation = useRef(0)

  function publish(next: Offspring[]) {
    live.current = next
    setChildren(next)
  }

  useEffect(() => {
    if (!children.length) return
    let last = performance.now()
    let oldActors = new Map<string, Point>()
    let oldChildren = new Map<number, Point>()
    function tick(now: number) {
      const elapsed = Math.max(.001, Math.min(.05, (now - last) / 1000))
      last = now
      const { area: bounds, actors, onImpact: sound } = scene.current
      const active = live.current.filter((child) => child.phase === 'young')
      const heldTargets = new Map<number, { from: Point; to: Point }>()
      for (const child of active) {
        const body = bodies.current.get(child.id)
        if (!body?.held) continue
        const from = oldChildren.get(child.id) ?? body
        heldTargets.set(child.id, { from: { x: from.x, y: from.y }, to: { x: body.x, y: body.y } })
        body.vx = constrain((body.x - from.x) / elapsed, -2800, 2800)
        body.vy = constrain((body.y - from.y) / elapsed, -2800, 2800)
      }
      const parents = actors.map((actor) => {
        const before = oldActors.get(actor.id) ?? actor.point
        return { ...actor, before, vx: constrain((actor.point.x - before.x) / elapsed, -3000, 3000),
          vy: constrain((actor.point.y - before.y) / elapsed, -3000, 3000) }
      })
      oldActors = new Map(actors.map(({ id, point }) => [id, point]))
      const steps = Math.ceil(elapsed / .005)
      const dt = elapsed / steps
      let changed = false
      function impact(body: Body, speed: number, edge: ImpactEdge) {
        body.edge = edge
        body.squash = Math.min(1, speed / 1450)
        if (speed < 130 || now - body.lastImpact < 105) return
        body.lastImpact = now
        sound({ x: body.x, y: body.y, edge, strength: Math.min(1, speed / 1600), slide: constrain(body.vx / 1200, -1, 1) })
      }
      for (let step = 0; step < steps; step++) {
        for (const child of active) {
          const body = bodies.current.get(child.id)
          if (!body) continue
          const heldTarget = heldTargets.get(child.id)
          if (heldTarget) {
            body.x = heldTarget.from.x + (heldTarget.to.x - heldTarget.from.x) * (step + 1) / steps
            body.y = heldTarget.from.y + (heldTarget.to.y - heldTarget.from.y) * (step + 1) / steps
            continue
          }
          const airborne = body.y < bounds.bottom - .15 || Math.abs(body.vy) > 1
          if (airborne || Math.abs(body.vx) > 1 || body.squash > .001) changed = true
          body.squash = Math.max(0, body.squash - dt * 5)
          if (airborne) body.vy += 1200 * dt
          body.x += body.vx * dt
          body.y += body.vy * dt
          if (body.x < bounds.left || body.x > bounds.right) {
            body.x = constrain(body.x, bounds.left, bounds.right)
            impact(body, Math.abs(body.vx), body.x === bounds.left ? 'left' : 'right')
            body.vx *= -.76
          }
          if (body.y < bounds.top) {
            body.y = bounds.top
            impact(body, Math.abs(body.vy), 'top')
            body.vy = Math.abs(body.vy) * .68
          }
          if (body.y >= bounds.bottom) {
            body.y = bounds.bottom
            impact(body, Math.abs(body.vy), 'bottom')
            body.vy = Math.abs(body.vy) < 130 ? 0 : -Math.abs(body.vy) * .62
            body.vx = Math.sign(body.vx) * Math.max(0, Math.abs(body.vx) - 720 * dt)
          } else body.vx *= Math.exp(-.15 * dt)

          for (const parent of parents) {
            const fraction = (step + 1) / steps
            const px = parent.before.x + (parent.point.x - parent.before.x) * fraction
            const py = parent.before.y + (parent.point.y - parent.before.y) * fraction
            const dx = body.x - px
            const dy = body.y - py
            const distance = Math.hypot(dx, dy)
            if (distance >= radius + 24 || !distance) continue
            const nx = dx / distance
            const ny = dy / distance
            const approach = (parent.vx - body.vx) * nx + (parent.vy - body.vy) * ny
            if (approach <= 22 || (!parent.active && Math.hypot(body.vx, body.vy) < 25)) continue
            const push = radius + 24 - distance + .5
            body.x = constrain(body.x + nx * push, bounds.left, bounds.right)
            body.y = constrain(body.y + ny * push, bounds.top, bounds.bottom)
            body.vx += nx * approach * 1.48
            body.vy += ny * approach * 1.48 - Math.min(130, approach * .12)
            impact(body, approach, 'bottom')
            changed = true
          }
        }
        // Neighbouring buckets bound collision work when many children pile up.
        const buckets = new Map<string, Array<{ id: number; body: Body }>>()
        for (const child of active) {
          const body = bodies.current.get(child.id)!
          const key = Math.floor(body.x / 40) + ',' + Math.floor(body.y / 40)
          const bucket = buckets.get(key)
          if (bucket) bucket.push({ id: child.id, body })
          else buckets.set(key, [{ id: child.id, body }])
        }
        const pairs: Array<[Body, Body]> = []
        for (const child of active) {
          const a = bodies.current.get(child.id)!
          const column = Math.floor(a.x / 40)
          const row = Math.floor(a.y / 40)
          for (const [ox, oy] of neighbours) {
            for (const entry of buckets.get((column + ox) + ',' + (row + oy)) ?? []) {
              if (entry.id > child.id) pairs.push([a, entry.body])
            }
          }
        }
        for (let pass = 0; pass < 3; pass++) {
          for (const [a, b] of pairs) {
            const dx = b.x - a.x
            const dy = b.y - a.y
            const distance = Math.hypot(dx, dy)
            if (distance >= radius * 2) continue
            const nx = distance > .001 ? dx / distance : 1
            const ny = distance > .001 ? dy / distance : 0
            const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
            const sum = Number(!a.held) + Number(!b.held)
            if (!sum) continue
            const force = Math.max(0, approach) * (approach > 145 ? 1.68 : 1) / sum
            const separation = (radius * 2 - distance + .2) / sum
            if (!a.held) {
              a.vx -= nx * force
              a.vy -= ny * force
              a.x = constrain(a.x - nx * separation, bounds.left, bounds.right)
              a.y = constrain(a.y - ny * separation, bounds.top, bounds.bottom)
              if (approach > 145) impact(a, approach, 'bottom')
            }
            if (!b.held) {
              b.vx += nx * force
              b.vy += ny * force
              b.x = constrain(b.x + nx * separation, bounds.left, bounds.right)
              b.y = constrain(b.y + ny * separation, bounds.top, bounds.bottom)
              if (approach > 145) impact(b, approach, 'bottom')
            }
            changed = true
          }
        }
      }
      oldChildren = new Map(active.map((child) => {
        const body = bodies.current.get(child.id)!
        body.vx = constrain(body.vx, -3000, 3000)
        body.vy = constrain(body.vy, -3000, 3000)
        return [child.id, { x: body.x, y: body.y }]
      }))
      if (changed) {
        publish(live.current.map((child) => {
          const body = bodies.current.get(child.id)
          if (!body || child.phase !== 'young') return child
          const flying = body.held || Math.abs(body.vx) > 1 || Math.abs(body.vy) > 1 || body.y < bounds.bottom - .15 || body.squash > .001
          return { ...child, x: body.x, held: body.held, flight: flying ? {
            x: body.x, y: body.y, velocity: { x: body.vx, y: body.vy }, squash: body.squash, edge: body.edge,
          } : null }
        }))
      }
      animation.current = requestAnimationFrame(tick)
    }
    animation.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animation.current)
  }, [children.length])

  function lay(near: Point, ordinal: number) {
    if (live.current.length >= limit) return
    const id = ++nextId.current
    const point = birthSpot(near.x, ordinal, bodies.current, scene.current.area)
    bodies.current.set(id, { ...point, vx: 0, vy: 0, squash: 0, edge: 'bottom', lastImpact: -Infinity, held: false })
    publish([...live.current, { id, x: point.x, phase: 'egg', flight: null }])
  }

  function hatch(id: number) {
    publish(live.current.map((child) => child.id === id && child.phase === 'egg' ? { ...child, phase: 'young' } : child))
  }

  function position(child: Offspring): Point {
    const body = bodies.current.get(child.id)
    return body ? { x: constrain(body.x, area.left, area.right), y: constrain(body.y, area.top, area.bottom) }
      : { x: constrain(child.x, area.left, area.right), y: area.bottom }
  }

  function bump(id: number, impulse: MascotImpulse) {
    const body = bodies.current.get(id)
    if (!body || body.held || live.current.find((child) => child.id === id)?.phase !== 'young') return
    body.vx += impulse.direction.x * impulse.strength
    body.vy = Math.min(-85, body.vy + impulse.direction.y * impulse.strength - 145)
  }

  function pop(id: number) {
    if (drag.current?.id === id) drag.current = null
    publish(live.current.map((child) => child.id === id && child.phase === 'young' ? { ...child, phase: 'popping' } : child))
  }

  function remove(id: number) {
    bodies.current.delete(id)
    publish(live.current.filter((child) => child.id !== id))
  }

  function grab(id: number, event: PointerEvent<HTMLButtonElement>) {
    const body = bodies.current.get(id)
    if (!body || event.button !== 0 || !event.isPrimary || drag.current) return
    event.preventDefault()
    body.held = true
    body.vx = body.vy = 0
    drag.current = { id, pointer: event.pointerId, offset: { x: event.clientX - body.x, y: event.clientY - body.y },
      moved: false, origin: { x: event.clientX, y: event.clientY },
      samples: [{ x: event.clientX, y: event.clientY, time: event.timeStamp }] }
    event.currentTarget.setPointerCapture(event.pointerId)
    publish(live.current.map((child) => child.id === id ? { ...child, held: true } : child))
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current
    const body = active && bodies.current.get(active.id)
    if (!active || !body || active.pointer !== event.pointerId) return
    const latest = active.samples.at(-1)!
    const dt = Math.max(.008, (event.timeStamp - latest.time) / 1000)
    const x = constrain(event.clientX - active.offset.x, area.left, area.right)
    const y = constrain(event.clientY - active.offset.y, area.top, area.bottom)
    body.vx = constrain((x - body.x) / dt, -2800, 2800)
    body.vy = constrain((y - body.y) / dt, -2800, 2800)
    body.x = x
    body.y = y
    active.moved ||= Math.hypot(event.clientX - active.origin.x, event.clientY - active.origin.y) > 4
    active.samples = [...active.samples.slice(-31), { x: event.clientX, y: event.clientY, time: event.timeStamp }]
    publish(live.current.map((child) => child.id === active.id ? { ...child, x, flight: {
      x, y, velocity: { x: body.vx, y: body.vy }, squash: 0, edge: 'bottom',
    } } : child))
  }

  function release(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current
    if (!active || active.pointer !== event.pointerId) return
    drag.current = null
    const body = bodies.current.get(active.id)
    if (!body) return
    body.held = false
    const velocity = event.type === 'pointerup' && active.moved
      ? throwVelocity(active.samples, { x: event.clientX, y: event.clientY, time: event.timeStamp }) : null
    body.vx = velocity?.x ?? 0
    body.vy = velocity?.y ?? (active.moved ? 0 : -290)
    if (!active.moved) body.vx = active.id % 2 ? 155 : -155
    publish(live.current.map((child) => child.id === active.id ? { ...child, held: false } : child))
  }

  function touch(id: number) {
    bump(id, { direction: { x: id % 2 ? .7 : -.7, y: -.71 }, strength: 335 })
  }

  function collideWith(actors: BroodActor[]) {
    scene.current.actors = actors
  }

  return { children, lay, hatch, position, bump, pop, remove, grab, move, release, touch, collideWith }
}
