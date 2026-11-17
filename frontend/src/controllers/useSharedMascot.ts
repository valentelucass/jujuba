import { useEffect, useRef, useState } from 'react'
import { flowCollaboration } from './api'
import type { FlightBounds, FlightFrame, Impact, Point } from './mascotMotion'
import type { MascotImpulse, MascotMeeting, MascotMeetingKind, MascotPose, MascotPreferences, MascotPresence, MascotRoom } from '../models/flowMascot'

const preferenceKey = 'jujuba.flow.mascots'
const normal = (value: number) => Math.max(0, Math.min(value, 1))
const greetingDistance = 60
const separateDistance = 86
const updateInterval = 65
const meetingTime = 1320

const closeReactions = ['hug', 'look', 'squeeze', 'kiss', 'dance', 'play'] as const
const brushReactions = ['push', 'squeeze', 'dance', 'hug', 'kiss', 'look'] as const

function readPreferences(): MascotPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? 'null')
    if (saved) {
      const remote = saved.remote === 'hidden' || saved.remote === 'full' ? saved.remote : 'dim'
      return { remote, shareOwn: saved.shareOwn !== false }
    }
  } catch { /* As preferências continuam funcionando durante esta sessão. */ }
  return { remote: 'dim', shareOwn: true }
}

function normalize(point: Point, limits: FlightBounds): Point {
  return {
    x: normal((point.x - limits.left) / Math.max(1, limits.right - limits.left)),
    y: normal((point.y - limits.top) / Math.max(1, limits.bottom - limits.top)),
  }
}

function project(point: Point, limits: FlightBounds): Point {
  return {
    x: limits.left + normal(point.x) * (limits.right - limits.left),
    y: limits.top + normal(point.y) * (limits.bottom - limits.top),
  }
}

function unit(x: number, y: number, fallback: Point = { x: 1, y: 0 }) {
  const length = Math.hypot(x, y)
  return length > 0 ? { x: x / length, y: y / length } : fallback
}

export function useSharedMascot(room: MascotRoom | null, {
  position, bounds, hat, pose, flight, kick, receiveSplat,
}: {
  position: Point; bounds: FlightBounds; hat: string; pose: MascotPose; flight: FlightFrame | null
  kick: (impulse: MascotImpulse, source: 'local' | 'remote') => void
  receiveSplat: (impact: Impact) => void
}) {
  const [preferences, setPreferences] = useState(readPreferences)
  const [shown, setShown] = useState<{ source: 'local' | 'remote'; room: string; event: MascotMeeting } | null>(null)
  const latest = useRef<MascotPresence | null>(null)
  const contact = useRef(false)
  const sequence = useRef(0)
  const ambientSequence = useRef(0)
  const brushSequence = useRef(0)
  const splatSequence = useRef(0)
  const lastInteraction = useRef(-Infinity)
  const lastImpact = useRef(-Infinity)
  const received = useRef(0)
  const receivedSplat = useRef(0)
  const react = useRef<(kind: 'ambient' | 'brush' | 'contact') => void>(() => {})
  const reactToKick = useRef(kick)
  reactToKick.current = kick
  const ensureSplat = useRef(receiveSplat)
  ensureSplat.current = receiveSplat
  const roomId = room?.id
  const peer = preferences.remote === 'hidden' ? null : room?.mascot
  const other = peer ? project(peer.position, bounds) : null
  const gap = other ? Math.hypot(position.x - other.x, position.y - other.y) : Infinity
  const overlap = Math.max(0, 46 - gap)
  const remotePoint = other ? {
    ...other,
    x: Math.max(bounds.left, Math.min(bounds.right,
      other.x + (other.x > (bounds.left + bounds.right) / 2 ? -overlap : overlap))),
  } : null
  const shouldReact = preferences.shareOwn && !!other
  const event = shown && shown.room === roomId && shouldReact ? shown.event : null
  const midpoint = other ? { x: (position.x + other.x) / 2, y: (position.y + other.y) / 2 } : null
  const moving = pose === 'held' || !!flight
  const scene = useRef({ room, bounds, midpoint, gap, share: preferences.shareOwn })
  scene.current = { room, bounds, midpoint, gap, share: preferences.shareOwn }

  latest.current = preferences.shareOwn ? {
    position: normalize(position, bounds),
    hat, pose,
    flight: flight ? { edge: flight.edge, velocityX: flight.velocity.x, squash: flight.squash } : null,
  } : null

  useEffect(() => {
    if (!roomId) return
    let pending = false
    let lastSent: string | undefined
    function publish() {
      const mascot = latest.current
      const snapshot = JSON.stringify(mascot)
      if (pending || lastSent === snapshot || !roomId) return
      pending = true
      void flowCollaboration.command(roomId, { type: 'mascot', mascot }).then(
        () => { lastSent = snapshot }, () => { /* Tenta no próximo intervalo da sessão. */ },
      ).finally(() => { pending = false })
    }
    contact.current = false
    received.current = 0
    receivedSplat.current = 0
    lastInteraction.current = -Infinity
    lastImpact.current = -Infinity
    publish()
    const interval = window.setInterval(publish, updateInterval)
    return () => window.clearInterval(interval)
  }, [roomId])

  useEffect(() => {
    if (!shown) return
    const timeout = window.setTimeout(() => setShown(null), meetingTime)
    return () => window.clearTimeout(timeout)
  }, [shown])

  const incoming = room?.meeting
  useEffect(() => {
    if (!incoming) {
      received.current = 0
      return
    }
    if (received.current === incoming.id) return
    received.current = incoming.id
    if (!roomId || !shouldReact) return
    lastInteraction.current = performance.now()
    setShown({ room: roomId, source: 'remote', event: incoming })
    if (incoming.impulse) {
      lastImpact.current = performance.now()
      reactToKick.current(incoming.impulse, 'remote')
    }
  }, [incoming, roomId, shouldReact])

  useEffect(() => {
    const list = room?.splats
    if (!list?.length) {
      receivedSplat.current = 0
      return
    }
    for (const mark of list) {
      if (mark.id <= receivedSplat.current) continue
      receivedSplat.current = mark.id
      if (peer) ensureSplat.current({ ...project(mark.position, scene.current.bounds), edge: mark.edge, slide: mark.slide, strength: mark.strength })
    }
  }, [room?.splats, peer])

  react.current = (trigger) => {
    if (!room || !other || !midpoint || !shouldReact || gap > separateDistance) return
    const now = performance.now()
    const direction = unit(other.x - position.x, other.y - position.y,
      flight ? unit(flight.velocity.x, flight.velocity.y) : { x: 1, y: 0 })
    const approach = flight ? flight.velocity.x * direction.x + flight.velocity.y * direction.y : 0
    const hit = room.rich && trigger === 'contact' && approach > 340 && now - lastImpact.current >= 430
    if (!hit && now - lastInteraction.current < (trigger === 'ambient' ? 1880 : 1300)) return
    if (trigger === 'ambient' && (!room.host || !room.rich || moving || peer?.pose === 'held' || peer?.flight)) return
    if (trigger === 'brush' && !room.rich) return

    let kind: MascotMeetingKind
    let impulse: MascotImpulse | undefined
    if (hit) {
      kind = 'bump'
      impulse = { direction, strength: Math.max(300, Math.min(1750, approach * .72)) }
    } else if (!room.rich) {
      kind = (approach > 340 ? ['bounce', 'play', 'kiss'] : ['kiss', 'play', 'bounce'])[sequence.current % 3] as MascotMeetingKind
    } else if (trigger === 'brush') {
      kind = brushReactions[brushSequence.current++ % brushReactions.length]
      if (kind === 'push') impulse = { direction, strength: 490 }
    } else {
      kind = closeReactions[ambientSequence.current++ % closeReactions.length]
    }

    lastInteraction.current = now
    const meeting = { id: ++sequence.current, kind, position: normalize(midpoint, bounds), impulse }
    setShown({ room: room.id, source: 'local', event: meeting })
    void flowCollaboration.command(room.id, { type: 'mascotMeeting', meeting }).catch(() => {})
    if (impulse) {
      lastImpact.current = now
      if (flight) reactToKick.current(impulse, 'local')
    }
  }

  useEffect(() => {
    if (!shouldReact || gap > separateDistance) {
      contact.current = false
      return
    }
    if (contact.current || gap > greetingDistance) return
    contact.current = true
    if (moving) react.current('contact')
  }, [gap, moving, shouldReact])

  useEffect(() => {
    if (!roomId) return
    const timer = window.setInterval(() => react.current('ambient'), 170)
    let previous: { x: number; y: number; time: number } | null = null
    let travel = 0
    function rubbing(event: PointerEvent) {
      const { midpoint: center, gap: distance } = scene.current
      if (event.pointerType === 'touch' || !center || distance > separateDistance ||
        Math.hypot(event.clientX - center.x - 33, event.clientY - center.y - 33) > 75) {
        previous = null
        travel = 0
        return
      }
      const now = performance.now()
      if (previous && now - previous.time < 360) {
        travel += Math.min(24, Math.hypot(event.clientX - previous.x, event.clientY - previous.y))
      } else {
        travel = 0
      }
      previous = { x: event.clientX, y: event.clientY, time: now }
      if (travel >= 66) {
        travel = 0
        react.current('brush')
      }
    }
    window.addEventListener('pointermove', rubbing, { passive: true })
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pointermove', rubbing)
    }
  }, [roomId])

  function shareImpact(impact: Impact) {
    const { room, bounds, share } = scene.current
    if (!room?.rich || !share) return
    const { x, y, edge, slide, strength } = impact
    const splat = { id: ++splatSequence.current, position: normalize({ x, y }, bounds), edge, slide, strength }
    void flowCollaboration.command(room.id, { type: 'mascotSplat', splat }).catch(() => {})
  }

  function savePreferences(next: MascotPreferences) {
    setPreferences(next)
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)) } catch { /* A seleção continua ativa nesta sessão. */ }
  }

  return {
    preferences, savePreferences, shareImpact,
    remote: peer && remotePoint ? { ...peer, point: remotePoint } : null,
    meeting: event ? { ...event, point: project(event.position, bounds),
      source: shown?.source, near: gap < separateDistance } : null,
  }
}
