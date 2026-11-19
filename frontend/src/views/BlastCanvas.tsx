import { useEffect, useRef } from 'react'
import smokeTexture from '../assets/smoke-billows.png'

let atlas: HTMLImageElement | undefined
export function preloadSmoke() {
  if (atlas) return
  atlas = new Image()
  atlas.src = smokeTexture
}

type Draw = (ctx: CanvasRenderingContext2D, width: number, height: number, ms: number, still: boolean, smoke: HTMLImageElement) => void

export function BlastCanvas({ className, duration, draw }: { className: string; duration: number; draw: Draw }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const painter = useRef(draw)
  painter.current = draw
  useEffect(() => {
    const surface = ref.current
    const context = surface?.getContext('2d')
    if (!surface || !context) return
    preloadSmoke()
    const image = atlas!
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const start = performance.now()
    let frame = 0
    let last = -Infinity

    const render = (now: number) => {
      frame = 0
      const ms = now - start
      if (ms - last >= 30 || motion.matches || ms >= duration) {
        const width = window.innerWidth
        const height = window.innerHeight
        const ratio = Math.min(window.devicePixelRatio || 1, 1.25, 1440 / width)
        const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio))
        if (surface.width !== w || surface.height !== h) { surface.width = w; surface.height = h }
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        context.clearRect(0, 0, width, height)
        painter.current(context, width, height, ms, motion.matches, image)
        last = ms
      }
      if (!motion.matches && ms < duration) frame = requestAnimationFrame(render)
    }
    function refresh() {
      cancelAnimationFrame(frame)
      last = -Infinity
      render(performance.now())
    }
    refresh()
    image.addEventListener('load', refresh)
    window.addEventListener('resize', refresh)
    motion.addEventListener('change', refresh)
    return () => {
      cancelAnimationFrame(frame)
      image.removeEventListener('load', refresh)
      window.removeEventListener('resize', refresh)
      motion.removeEventListener('change', refresh)
    }
  }, [duration])
  return <canvas className={className} ref={ref} aria-hidden="true" />
}
