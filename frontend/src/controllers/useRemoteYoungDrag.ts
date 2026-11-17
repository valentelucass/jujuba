import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { flowCollaboration } from './api'
import { throwVelocity, type Point, type PointerSample } from './mascotMotion'
import type { ChildDrag } from '../models/flowMascot'

type Held = { id: number; pointer: number; offset: Point; point: Point; samples: PointerSample[] }

export function useRemoteYoungDrag(room: string | undefined, peer: string, unproject: (point: Point) => Point) {
  const drag = useRef<Held | null>(null)
  const [held, setHeld] = useState<{ id: number; point: Point } | null>(null)
  const queue = useRef<ChildDrag[]>([])
  const sending = useRef(false)
  const transform = useRef(unproject)
  transform.current = unproject

  async function send(action: ChildDrag) {
    if (!room) return
    if (action.kind === 'move' && queue.current.at(-1)?.kind === 'move') queue.current.pop()
    queue.current.push(action)
    if (sending.current) return
    sending.current = true
    try {
      for (let next = queue.current.shift(); next; next = queue.current.shift()) {
        await flowCollaboration.command(room, { type: 'childDrag', owner: peer, drag: next }).catch(() => {})
      }
    } finally {
      sending.current = false
    }
  }

  function cancel() {
    const active = drag.current
    if (!active) return
    drag.current = null
    void send({ id: active.id, kind: 'release', point: transform.current(active.point) })
    setHeld(null)
  }

  useEffect(() => () => { cancel() }, [room, peer])

  function grab(id: number, at: Point, locked: boolean, event: PointerEvent<HTMLButtonElement>) {
    if (!room || locked || event.button !== 0 || !event.isPrimary || drag.current) return
    event.preventDefault()
    event.stopPropagation()
    const { clientX: x, clientY: y, pointerId: pointer, timeStamp: time } = event
    drag.current = { id, pointer, offset: { x: x - at.x, y: y - at.y }, point: at, samples: [{ x, y, time }] }
    event.currentTarget.setPointerCapture(pointer)
    setHeld({ id, point: at })
    void send({ id, kind: 'grab', point: unproject(at) })
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current
    if (active?.pointer !== event.pointerId) return
    const { clientX: x, clientY: y, timeStamp: time } = event
    active.point = { x: x - active.offset.x, y: y - active.offset.y }
    active.samples = [...active.samples.slice(-15), { x, y, time }]
    setHeld({ id: active.id, point: active.point })
    void send({ id: active.id, kind: 'move', point: unproject(active.point) })
  }

  function release(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current
    if (active?.pointer !== event.pointerId) return
    drag.current = null
    setHeld(null)
    const velocity = event.type === 'pointerup' ? throwVelocity(active.samples, {
      x: event.clientX, y: event.clientY, time: event.timeStamp,
    }) : null
    void send({ id: active.id, kind: 'release', point: unproject(active.point),
      velocity: velocity ? { x: Math.max(-8, Math.min(8, velocity.x / window.innerWidth)),
        y: Math.max(-8, Math.min(8, velocity.y / window.innerHeight)) } : undefined })
  }

  return { held, grab, move, release, cancel }
}
