import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Impact, Point, PointerSample } from './mascotMotion'

type Options = { confetti: boolean; tickles: boolean; stamps: boolean; paused: boolean }
type Candy = { dx: number; rise: number; fall: number; spin: number; size: number; color: string }
type Effect = Point & { id: number; expires: number }
export type JellyEffect = (Effect & { kind: 'candies'; pieces: Candy[] }) |
  (Effect & { kind: 'stamp'; angle: number; size: number; tint: string; squash: number })

const candyColors = ['#ff5da9', '#ffd767', '#a897ff', '#61e8c6', '#80c6ff', '#ff9264']
const vary = (min: number, max: number) => min + Math.random() * (max - min)

type Shake = { point: Point; time: number; direction: Point; turns: number; since: number }

export function useJellyPlay(options: Options, playSound: (sound: 'giggle' | 'sprinkle', intensity: number) => void) {
  const [effects, setEffects] = useState<JellyEffect[]>([])
  const [laughing, setLaughing] = useState(false)
  const active = useRef(options)
  active.current = options
  const serial = useRef(0)
  const shake = useRef<Shake | null>(null)
  const rub = useRef<PointerSample | null>(null)
  const lastBurst = useRef(-Infinity)
  const lastLaugh = useRef(-Infinity)

  useEffect(() => {
    const first = effects.reduce((earliest, effect) => Math.min(earliest, effect.expires), Infinity)
    if (!Number.isFinite(first)) return
    const timer = window.setTimeout(() => {
      const now = performance.now()
      setEffects((items) => items.filter((effect) => effect.expires > now))
    }, Math.max(1, Math.ceil(first - performance.now())))
    return () => window.clearTimeout(timer)
  }, [effects])

  useEffect(() => {
    if (!laughing) return
    const timer = window.setTimeout(() => setLaughing(false), 640)
    return () => window.clearTimeout(timer)
  }, [laughing])

  useEffect(() => {
    if (options.paused || !options.tickles) { rub.current = null; setLaughing(false) }
    if (options.paused || !options.confetti) shake.current = null
    setEffects((items) => items.filter(({ kind }) => !options.paused && (kind === 'candies' ? options.confetti : options.stamps)))
  }, [options.paused, options.confetti, options.tickles, options.stamps])

  function resetGesture() {
    shake.current = null
    rub.current = null
  }

  function burst(point: Point) {
    const now = performance.now()
    if (now - lastBurst.current < 660) return
    lastBurst.current = now
    const pieces = Array.from({ length: 16 }, (_, index) => ({
      dx: vary(-83, 83), rise: vary(22, 70), fall: vary(30, 106), spin: vary(-225, 225),
      size: vary(3.5, 6.5), color: candyColors[(index + serial.current) % candyColors.length],
    }))
    const effect: JellyEffect = { ...point, id: ++serial.current, kind: 'candies', pieces, expires: now + 930 }
    setEffects((items) => [...items.slice(-47), effect])
    playSound('sprinkle', .58)
  }

  function shaking(point: Point, time: number) {
    const previous = shake.current
    if (!previous || time - previous.time > 200 || time - previous.since > 680) {
      shake.current = { point, time, since: time, direction: { x: 0, y: 0 }, turns: 0 }
      return false
    }
    const dx = point.x - previous.point.x
    const dy = point.y - previous.point.y
    const distance = Math.hypot(dx, dy)
    if (distance < 16) return false
    const direction = { x: dx / distance, y: dy / distance }
    const reverse = direction.x * previous.direction.x + direction.y * previous.direction.y < -.48
    const turns = previous.turns + (reverse ? 1 : 0)
    shake.current = { point, time, direction, since: previous.since, turns }
    if (turns < 2) return false
    shake.current = null
    return true
  }

  function move(event: PointerEvent<HTMLButtonElement>, dragging: boolean, inFlight: boolean) {
    if (active.current.paused || !event.isPrimary) return
    const at = { x: event.clientX, y: event.clientY }
    if (dragging) {
      rub.current = null
      if (active.current.confetti && shaking(at, event.timeStamp)) burst(at)
      return
    }
    if (inFlight || !active.current.tickles || event.pointerType === 'touch' || event.buttons !== 0) {
      rub.current = null
      return
    }
    const box = event.currentTarget.getBoundingClientRect()
    const x = (at.x - box.left) / box.width
    const y = (at.y - box.top) / box.height
    if (x < .19 || x > .81 || y < .52 || y > .83) { rub.current = null; return }
    const previous = rub.current
    const time = event.timeStamp
    if (previous && time - previous.time < 130) {
      const travel = Math.hypot(at.x - previous.x, at.y - previous.y)
      if (travel < 9) return
      if (travel / Math.max(1, time - previous.time) > .17 && time - lastLaugh.current > 840) {
        lastLaugh.current = time
        setLaughing(true)
        playSound('giggle', .76)
      }
    }
    rub.current = { ...at, time }
  }

  function bounce(impact: Impact, launcherSize: number, color: string) {
    if (active.current.paused || !active.current.stamps) return
    const radius = launcherSize / 2
    const side = impact.edge === 'left' || impact.edge === 'right'
    const size = 21 + impact.strength * 17
    const inset = radius - size * .34
    const effect: JellyEffect = {
      kind: 'stamp', id: ++serial.current, expires: performance.now() + 7800,
      x: impact.x + radius + (side ? impact.edge === 'right' ? inset : -inset : 0),
      y: impact.y + radius + (side ? 0 : impact.edge === 'bottom' ? inset : -inset),
      angle: { top: 180, right: -90, bottom: 0, left: 90 }[impact.edge] + impact.slide * 15 + vary(-8, 8),
      size, tint: color, squash: 1 - impact.strength * .26,
    }
    setEffects((items) => [...items.slice(-47), effect])
  }

  return { effects, laughing, move, resetGesture, bounce }
}
