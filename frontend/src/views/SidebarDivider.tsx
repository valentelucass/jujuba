import { useRef, type PointerEvent } from 'react'

export function SidebarDivider({ side, width, minimum, maximum, defaultWidth, label, controls, onWidth, onDrag }: {
  side: 'left' | 'right'
  width: number
  minimum: number
  maximum: number
  defaultWidth: number
  label: string
  controls: string
  onWidth: (next: number, settled: boolean) => void
  onDrag: (dragging: boolean) => void
}) {
  const start = useRef<number | null>(null)
  const moved = useRef(false)

  function clamp(width: number) {
    return Math.max(minimum, Math.min(maximum, Math.round(width)))
  }

  function pointerWidth(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.parentElement!.getBoundingClientRect()
    return clamp(side === 'left' ? event.clientX - bounds.left : bounds.right - event.clientX)
  }

  return <div role="separator" tabIndex={0} aria-label={label} aria-controls={controls}
    aria-orientation="vertical" aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={width}
    title="Arraste para ajustar. Clique duas vezes para restaurar."
    className={'explorer-divider sidebar-divider-' + side}
    onDoubleClick={() => onWidth(clamp(defaultWidth), true)}
    onKeyDown={(event) => {
      const step = (event.shiftKey ? 50 : 16) * (side === 'left' ? 1 : -1)
      const next = { ArrowLeft: width - step, ArrowRight: width + step, Home: minimum, End: maximum }[event.key]
      if (next === undefined) return
      event.preventDefault()
      onWidth(clamp(next), true)
    }}
    onPointerDown={(event) => {
      if (event.button !== 0) return
      start.current = event.clientX
      moved.current = false
      event.currentTarget.setPointerCapture(event.pointerId)
      onDrag(true)
    }}
    onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId) || start.current === null) return
      if (moved.current || Math.abs(event.clientX - start.current) >= 3) {
        moved.current = true
        onWidth(pointerWidth(event), false)
      }
    }}
    onPointerUp={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      if (moved.current) onWidth(pointerWidth(event), true)
      event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onLostPointerCapture={() => {
      start.current = null
      onDrag(false)
    }} />
}
