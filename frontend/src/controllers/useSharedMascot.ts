import { useEffect, useRef, useState, type RefObject } from 'react'
import { flowCollaboration } from './api'
import type { FlightBounds, FlightFrame, Impact, Point } from './mascotMotion'
import { separateMascots } from './mascotMotion'
import type { MascotScene } from '../models/mascotScene'
import type { FlowParticipant, MascotImpulse, MascotMeeting, MascotMeetingKind, MascotPose, MascotPreferences, MascotPresence, MascotRoom, MascotVisibility } from '../models/flowMascot'

const preferenceKey = 'jujuba.flow.mascots'
const normal = (value: number) => Math.max(0, Math.min(value, 1))
const greetingDistance = 60
const separateDistance = 86
const updateInterval = 32
const meetingTime = 1320
const hugTime = 7200

const closeReactions = ['hug', 'look', 'squeeze', 'kiss', 'dance', 'play'] as const
const brushReactions = ['push', 'squeeze', 'dance', 'hug', 'kiss', 'look'] as const

function readPreferences(): MascotPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? 'null')
    if (saved) {
      const remote = saved.remote === 'hidden' || saved.remote === 'full' ? saved.remote : 'dim'
      return { remote, shareOwn: saved.shareOwn !== false, paused: saved.paused === true, byPeer: {} }
    }
  } catch { /* As preferências continuam funcionando durante esta sessão. */ }
  return { remote: 'dim', shareOwn: true, paused: false, byPeer: {} }
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

type Practice = {
  point: Point; held: boolean; flight: FlightFrame | null; boost: (impulse: MascotImpulse, recoil?: boolean, from?: Point) => void
  relocate: (point: Point) => void
}

export type VisibleMascot = {
  member: FlowParticipant
  appearance: MascotPresence & { point: Point }
  visibility: MascotVisibility
}

export function useSharedMascot(network: MascotRoom | null, {
  position, bounds, hat, color, pose, flight, kick, relocate, receiveSplat, practice, scene: sharedScene, gathering = false,
}: {
  position: Point; bounds: FlightBounds; hat: string; color: string; pose: MascotPose; flight: FlightFrame | null
  kick: (impulse: MascotImpulse, source: 'local' | 'remote', from?: Point) => void
  relocate: (point: Point) => void
  receiveSplat?: (impact: Impact, peer: string, peerColor?: string) => void
  gathering?: boolean
  practice?: Practice | null
  scene?: RefObject<(() => MascotScene) | null>
}) {
  const [preferences, setPreferences] = useState(readPreferences)
  const [shown, setShown] = useState<{ source: 'local' | 'remote'; room: string; peer?: string; event: MascotMeeting } | null>(null)
  const latest = useRef<MascotPresence | null>(null)
  const contact = useRef(false)
  const sequence = useRef(0)
  const ambientSequence = useRef(0)
  const brushSequence = useRef(0)
  const splatSequence = useRef(0)
  const lastInteraction = useRef(-Infinity)
  const lastImpact = useRef(-Infinity)
  const received = useRef(new Map<string, number>())
  const receivedSplat = useRef(new Map<string, number>())
  const previousPair = useRef<{ room: string; own: Point; other: Point; time: number } | null>(null)
  const react = useRef<(kind: 'ambient' | 'brush' | 'contact') => void>(() => {})
  const reactToKick = useRef(kick)
  reactToKick.current = kick
  const ensureSplat = useRef(receiveSplat)
  ensureSplat.current = receiveSplat
  const members: FlowParticipant[] = network?.selfId ? network.members ?? [] : network ? [{
    id: 'legacy', name: network.peer, group: false, cursor: null, mascot: network.mascot, meeting: network.meeting, splats: network.splats,
  }] : []
  const visibilityFor = (id: string) => preferences.paused ? 'hidden' : preferences.byPeer[id] ?? preferences.remote
  const quiet = preferences.paused || (!!members.length && members.every(({ id }) => visibilityFor(id) === 'hidden'))
  const visible = members.flatMap<VisibleMascot>((member) => {
    const visibility = visibilityFor(member.id)
    return visibility === 'hidden' || !member.mascot ? [] : [{
      member, visibility, appearance: { ...member.mascot, point: project(member.mascot.position, bounds) },
    }]
  })
  const nearest = visible.reduce<VisibleMascot | undefined>((closest, candidate) => {
    if (!closest) return candidate
    const distance = ({ appearance }: VisibleMascot) => Math.hypot(appearance.point.x - position.x, appearance.point.y - position.y)
    return distance(candidate) < distance(closest) ? candidate : closest
  }, undefined)
  const selectedPeer = nearest?.member.id
  const peer = nearest?.appearance ?? null
  const room = network
  const localOnly = !!practice
  const roomId = localOnly ? 'mascot-clone' : room?.id
  const rich = localOnly || !!room?.rich
  const other = practice?.point ?? peer?.point ?? null
  const gap = other ? Math.hypot(position.x - other.x, position.y - other.y) : Infinity
  const shouldReact = !gathering && (localOnly || preferences.shareOwn) && !quiet && !!other
  const event = shown && shown.room === roomId && shown.peer === selectedPeer && shouldReact ? shown.event : null
  const midpoint = other ? { x: (position.x + other.x) / 2, y: (position.y + other.y) / 2 } : null
  const moving = pose === 'held' || !!flight
  const practiceMoving = !!practice && (practice.held || !!practice.flight)
  const peerMoving = !!(practiceMoving || peer?.pose === 'held' || peer?.flight)
  const hugging = event?.kind === 'hug' && gap < separateDistance && !moving && !peerMoving
  const scene = useRef({ room, bounds, midpoint, gap, share: preferences.shareOwn })
  scene.current = { room, bounds, midpoint, gap, share: preferences.shareOwn && !quiet }

  latest.current = preferences.shareOwn && !quiet ? {
    position: normalize(position, bounds),
    hat, color, pose,
    flight: flight ? { edge: flight.edge, velocityX: flight.velocity.x, squash: flight.squash } : null,
  } : null

  useEffect(() => {
    if (!roomId) return
    let pending = false
    let lastSent: string | undefined
    function publish() {
      if (pending || !roomId) return
      const mascot = latest.current ? { ...latest.current, scene: sharedScene?.current?.() } : null
      const snapshot = JSON.stringify(mascot)
      if (lastSent === snapshot) return
      pending = true
      void flowCollaboration.command(roomId, { type: 'mascot', mascot }).then(
        () => { lastSent = snapshot }, () => { /* Tenta no próximo intervalo da sessão. */ },
      ).finally(() => { pending = false })
    }
    contact.current = false
    received.current.clear()
    receivedSplat.current.clear()
    lastInteraction.current = -Infinity
    lastImpact.current = -Infinity
    if (localOnly) ambientSequence.current = 0
    if (localOnly) return
    publish()
    const interval = window.setInterval(publish, updateInterval)
    return () => window.clearInterval(interval)
  }, [roomId, localOnly])

  useEffect(() => {
    if (!shown) return
    const timeout = window.setTimeout(() => setShown(null), shown.event.kind === 'hug' ? hugTime : meetingTime)
    return () => window.clearTimeout(timeout)
  }, [shown])

  useEffect(() => {
    if (shown?.event.kind === 'hug' && !hugging) setShown((current) => current === shown ? null : current)
  }, [hugging, shown])

  const incoming = nearest?.member.meeting
  useEffect(() => {
    if (!incoming || !selectedPeer || (incoming.peer && incoming.peer !== room?.selfId)) return
    if (received.current.get(selectedPeer) === incoming.id) return
    received.current.set(selectedPeer, incoming.id)
    if (!roomId || !shouldReact) return
    lastInteraction.current = performance.now()
    setShown({ room: roomId, peer: selectedPeer, source: 'remote', event: incoming })
    if (incoming.impulse) {
      lastImpact.current = performance.now()
      reactToKick.current(incoming.impulse, 'remote')
    }
  }, [incoming, roomId, selectedPeer, shouldReact])

  useEffect(() => {
    for (const member of members) {
      if (!member.splats.length) receivedSplat.current.delete(member.id)
      for (const mark of member.splats) {
        if (mark.id <= (receivedSplat.current.get(member.id) ?? 0)) continue
        receivedSplat.current.set(member.id, mark.id)
        if (visibilityFor(member.id) !== 'hidden' && member.mascot) {
          ensureSplat.current?.({ ...project(mark.position, scene.current.bounds), edge: mark.edge, slide: mark.slide, strength: mark.strength }, member.id, member.mascot.color)
        }
      }
    }
  }, [members, preferences])

  useEffect(() => {
    if (!roomId || !other || !shouldReact) {
      previousPair.current = null
      return
    }
    const now = performance.now()
    const previous = previousPair.current
    previousPair.current = { room: roomId, own: { ...position }, other: { ...other }, time: now }
    const elapsed = Math.max(.012, Math.min(.12, (now - (previous?.time ?? now)) / 1000))
    const ownVelocity = flight?.velocity ?? (previous?.room === roomId ? {
      x: (position.x - previous.own.x) / elapsed, y: (position.y - previous.own.y) / elapsed,
    } : { x: 0, y: 0 })
    const otherVelocity = practice?.flight?.velocity ?? (previous?.room === roomId ? {
      x: (other.x - previous.other.x) / elapsed, y: (other.y - previous.other.y) / elapsed,
    } : { x: 0, y: 0 })
    const defaultDirection = { x: room?.selfId && selectedPeer ? (room.selfId < selectedPeer ? 1 : -1) : room?.host === false ? -1 : 1, y: 0 }
    const fallback = previous ? unit(previous.other.x - previous.own.x, previous.other.y - previous.own.y, defaultDirection) : defaultDirection
    const direction = unit(other.x - position.x, other.y - position.y, fallback)
    const separated = gap < 49.5 ? separateMascots(position, other, bounds, direction) : null
    if (separated) {
      relocate(separated.first)
      practice?.relocate(separated.second)
    }
    if (gap > 55 || !rich || now - lastImpact.current < 420) return
    const approach = (ownVelocity.x - otherVelocity.x) * direction.x + (ownVelocity.y - otherVelocity.y) * direction.y
    if (approach < 900 || (!moving && !practiceMoving && !peerMoving)) return
    const fromPeer = otherVelocity.x * direction.x + otherVelocity.y * direction.y < -(ownVelocity.x * direction.x + ownVelocity.y * direction.y)
    const impulse = { direction: fromPeer ? { x: -direction.x, y: -direction.y } : direction,
      strength: Math.max(180, Math.min(1250, approach * .46)) }
    lastImpact.current = now
    announce(roomId, 'bump', midpoint ?? position, impulse)
    practice?.boost(impulse, fromPeer, separated?.second)
    reactToKick.current(impulse, fromPeer ? 'remote' : 'local', separated?.first)
  }, [roomId, shouldReact, position.x, position.y, other?.x, other?.y, moving, practiceMoving, peerMoving])

  react.current = (trigger) => {
    if (!roomId || !other || !midpoint || !shouldReact || gap > separateDistance) return
    const now = performance.now()
    const direction = unit(other.x - position.x, other.y - position.y,
      flight ? unit(flight.velocity.x, flight.velocity.y) : { x: 1, y: 0 })
    const approach = flight ? flight.velocity.x * direction.x + flight.velocity.y * direction.y : 0
    const practiceVelocity = practice?.flight?.velocity
    const practiceApproach = practiceVelocity ? -(practiceVelocity.x * direction.x + practiceVelocity.y * direction.y) : 0
    const hit = rich && trigger === 'contact' && Math.max(approach, practiceApproach) > 340 && now - lastImpact.current >= 430
    const initiatedByPractice = hit && practiceApproach > approach
    if (hugging && !hit) return
    if (localOnly && trigger === 'contact' && !hit) return
    if (!hit && now - lastInteraction.current < (trigger === 'ambient' ? 1880 : 1300)) return
    if (trigger === 'ambient' && ((!localOnly && !(room?.selfId && selectedPeer && selectedPeer !== 'legacy'
      ? room.selfId < selectedPeer : room?.host)) || !rich || moving || peerMoving)) return
    if (trigger === 'brush' && (!rich || moving || peerMoving)) return

    let kind: MascotMeetingKind
    let impulse: MascotImpulse | undefined
    if (hit) {
      kind = 'bump'
      impulse = { direction: initiatedByPractice ? { x: -direction.x, y: -direction.y } : direction,
        strength: Math.max(300, Math.min(1750, Math.max(approach, practiceApproach) * .72)) }
    } else if (!rich) {
      kind = (approach > 340 ? ['bounce', 'play', 'kiss'] : ['kiss', 'play', 'bounce'])[sequence.current % 3] as MascotMeetingKind
    } else if (trigger === 'brush') {
      kind = brushReactions[brushSequence.current++ % brushReactions.length]
      if (kind === 'push') impulse = { direction, strength: 490 }
    } else {
      kind = closeReactions[ambientSequence.current++ % closeReactions.length]
    }

    announce(roomId, kind, midpoint, impulse)
    if (impulse) {
      lastImpact.current = now
      practice?.boost(impulse, initiatedByPractice)
      if (initiatedByPractice || flight) reactToKick.current(impulse, initiatedByPractice ? 'remote' : 'local')
    }
  }

  useEffect(() => {
    if (!shouldReact || gap > separateDistance) {
      contact.current = false
      return
    }
    if (contact.current || gap > greetingDistance) return
    contact.current = true
    if (!rich && (moving || practiceMoving)) react.current('contact')
  }, [gap, moving, practiceMoving, shouldReact])

  useEffect(() => {
    if (!roomId) return
    const timer = window.setInterval(() => react.current('ambient'), 170)
    let previous: { x: number; y: number; time: number } | null = null
    let travel = 0
    function rubbing(event: PointerEvent) {
      const { midpoint: center, gap: distance } = scene.current
      if (event.pointerType === 'touch' || event.buttons !== 0 || !center || distance > separateDistance ||
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

  function pushPeer(impulse: MascotImpulse) {
    if (!roomId || !rich || !other || !shouldReact) return
    lastImpact.current = performance.now()
    announce(roomId, 'bump', other, impulse)
    practice?.boost(impulse)
  }

  function announce(id: string, kind: MascotMeetingKind, point: Point, impulse?: MascotImpulse) {
    lastInteraction.current = performance.now()
    const meeting = { id: ++sequence.current, kind, position: normalize(point, bounds), impulse,
      peer: room?.selfId && selectedPeer !== 'legacy' ? selectedPeer : undefined }
    setShown({ room: id, peer: selectedPeer, source: 'local', event: meeting })
    if (!localOnly) void flowCollaboration.command(id, { type: 'mascotMeeting', meeting }).catch(() => {})
  }

  function savePreferences(next: MascotPreferences) {
    setPreferences(next)
    try {
      const { byPeer: _room, ...saved } = next
      localStorage.setItem(preferenceKey, JSON.stringify(saved))
    } catch { /* A seleção continua ativa nesta sessão. */ }
  }

  return {
    preferences, savePreferences, shareImpact, pushPeer,
    remote: peer && other ? { ...peer, point: other } : null,
    members, visible, selectedPeer, visibilityFor, quiet,
    hug: hugging && midpoint && shown ? { key: shown.source + '-' + event.id, point: midpoint } : null,
    meeting: event ? { ...event, point: project(event.position, bounds),
      source: shown?.source, near: event.kind === 'hug' ? hugging : gap < separateDistance } : null,
  }
}
