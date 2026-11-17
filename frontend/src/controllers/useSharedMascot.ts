import { useEffect, useRef, useState } from 'react'
import { flowCollaboration } from './api'
import type { FlightBounds, FlightFrame, Point } from './mascotMotion'
import type { MascotMeeting, MascotPose, MascotPreferences, MascotPresence, MascotRoom } from '../models/flowMascot'

const preferenceKey = 'jujuba.flow.mascots'
const normal = (value: number) => Math.max(0, Math.min(value, 1))
const greetingDistance = 60
const separateDistance = 86
const updateInterval = 65
const meetingTime = 920

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

export function useSharedMascot(room: MascotRoom | null, {
  position, bounds, hat, pose, flight,
}: {
  position: Point; bounds: FlightBounds; hat: string; pose: MascotPose; flight: FlightFrame | null
}) {
  const [preferences, setPreferences] = useState(readPreferences)
  const [shown, setShown] = useState<{ source: 'local' | 'remote'; room: string; event: MascotMeeting } | null>(null)
  const latest = useRef<MascotPresence | null>(null)
  const contact = useRef(false)
  const sequence = useRef(0)
  const lastInteraction = useRef(-Infinity)
  const received = useRef(0)
  const roomId = room?.id
  const peer = preferences.remote === 'hidden' ? null : room?.mascot
  const other = peer ? project(peer.position, bounds) : null
  const gap = other ? Math.hypot(position.x - other.x, position.y - other.y) : Infinity
  const overlap = Math.max(0, 42 - gap)
  const remotePoint = other ? {
    ...other,
    x: Math.max(bounds.left, Math.min(bounds.right,
      other.x + (other.x > (bounds.left + bounds.right) / 2 ? -overlap : overlap))),
  } : null
  const shouldReact = preferences.shareOwn && !!other
  const event = shown && shown.room === roomId && shouldReact ? shown.event : null

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
        () => { lastSent = snapshot }, () => { /* Tenta novamente no próximo intervalo da sessão. */ },
      ).finally(() => { pending = false })
    }
    contact.current = false
    received.current = 0
    lastInteraction.current = -Infinity
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
  }, [incoming, roomId, shouldReact])

  const moving = pose === 'held' || !!flight
  const speed = flight ? Math.hypot(flight.velocity.x, flight.velocity.y) : 0
  useEffect(() => {
    if (!roomId || !other || !shouldReact || gap > separateDistance) {
      contact.current = false
      return
    }
    if (contact.current || gap > greetingDistance) return
    contact.current = true
    const now = performance.now()
    if (!moving || now - lastInteraction.current < 1200) return
    lastInteraction.current = now
    const rotation = speed > 920 ? ['bounce', 'play', 'kiss'] as const : ['kiss', 'play', 'bounce'] as const
    const kind = rotation[sequence.current % rotation.length]
    const meeting = {
      id: ++sequence.current,
      kind,
      position: normalize({ x: (position.x + other.x) / 2, y: (position.y + other.y) / 2 }, bounds),
    }
    setShown({ room: roomId, source: 'local', event: meeting })
    void flowCollaboration.command(roomId, { type: 'mascotMeeting', meeting }).catch(() => {})
  }, [bounds, gap, moving, other, position, roomId, shouldReact, speed])

  function savePreferences(next: MascotPreferences) {
    setPreferences(next)
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)) } catch { /* A seleção continua ativa nesta sessão. */ }
  }

  return {
    preferences, savePreferences,
    remote: peer && remotePoint ? { ...peer, point: remotePoint } : null,
    meeting: event ? { ...event, point: project(event.position, bounds),
      source: shown?.source, near: gap < separateDistance } : null,
  }
}
