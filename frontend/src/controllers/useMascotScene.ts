import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { FlightFrame, Point } from './mascotMotion'
import type { Offspring } from './useMascotBrood'
import type { MascotImpulse, MascotMeetingKind, MascotRoom } from '../models/flowMascot'
import { mapToy, type MascotScene, type SceneHit, type SceneSound, type SceneSoundKind, type ToyKind, type ToyVisual } from '../models/mascotScene'

type Companion = { point: Point | null; held: boolean; flight: FlightFrame | null; greeting?: MascotMeetingKind; direction: Point }
const normal = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 10000) / 10000

export function useMascotScene(outgoing: RefObject<(() => MascotScene) | null>, {
  room, own, clone, hat, children, childPosition, peerPoint, receiveHit, fireSound,
}: {
  room: MascotRoom | null; own: Point; clone: Companion; hat: string; children: Offspring[]
  childPosition: (child: Offspring) => Point; peerPoint: Point | null
  receiveHit: (hit: SceneHit) => void; fireSound: (kind: ToyKind | SceneSoundKind, strength?: number) => void
}) {
  const toy = useRef<ToyVisual | null>(null)
  const hits = useRef<SceneHit[]>([])
  const sounds = useRef<SceneSound[]>([])
  const sequence = useRef(0)
  const received = useRef(0)
  const receivedEpoch = useRef(0)
  const receivedSound = useRef(0)
  const epoch = useRef(0)
  const soundCursor = useRef({ epoch: 0, shot: 0 })
  const latest = useRef({ own, clone, hat, children, childPosition, receiveHit, fireSound })
  latest.current = { own, clone, hat, children, childPosition, receiveHit, fireSound }
  const roomId = room?.id

  const setToy = useCallback((next: ToyVisual | null) => { toy.current = next }, [])

  useEffect(() => {
    hits.current = []
    sounds.current = []
    receivedSound.current = 0
    epoch.current = crypto.getRandomValues(new Uint32Array(1))[0] || 1
    received.current = 0
    soundCursor.current = { epoch: 0, shot: 0 }
    if (!roomId) {
      outgoing.current = null
      return
    }
    outgoing.current = () => {
      const { own, clone, hat, children, childPosition } = latest.current
      const normalize = (point: Point): Point => ({ x: normal(point.x / window.innerWidth), y: normal(point.y / window.innerHeight) })
      return {
        epoch: epoch.current, origin: normalize(own), toy: toy.current ? mapToy(toy.current, normalize) : null,
        clone: clone.point ? { point: normalize({ x: clone.point.x + 33, y: clone.point.y + 33 }), hat,
          pose: clone.held ? 'held' : 'idle', greeting: clone.greeting, direction: clone.direction, flight: clone.flight ? {
            edge: clone.flight.edge, squash: clone.flight.squash, velocityX: clone.flight.velocity.x,
          } : null } : null,
        young: children.map((child) => ({
          id: child.id, point: normalize(childPosition(child)), phase: child.phase, held: !!child.held,
          rotation: Math.round((child.flight?.velocity.x ?? 0) / 9.5) / 10,
          squash: Math.round((child.flight?.squash ?? 0) * 100) / 100,
        })),
        hits: hits.current, sounds: sounds.current,
      }
    }
    return () => { outgoing.current = null }
  }, [roomId, outgoing])

  const incoming = peerPoint ? room?.mascot?.scene : null
  useEffect(() => {
    if (!incoming) return
    if (incoming.epoch !== receivedEpoch.current) {
      receivedEpoch.current = incoming.epoch
      received.current = 0
      receivedSound.current = 0
      soundCursor.current = { epoch: 0, shot: 0 }
    }
    for (const hit of incoming.hits) {
      if (hit.id <= received.current) continue
      received.current = hit.id
      latest.current.receiveHit(hit)
    }
    for (const sound of incoming.sounds ?? []) {
      if (sound.id <= receivedSound.current) continue
      receivedSound.current = sound.id
      latest.current.fireSound(sound.kind, sound.strength)
    }
    const weapon = incoming.toy
    if (!weapon) return
    if (weapon.epoch !== soundCursor.current.epoch) soundCursor.current = { epoch: weapon.epoch, shot: 0 }
    const newest = Math.max(0, ...weapon.shots.map(({ id }) => id))
    if (newest > soundCursor.current.shot) {
      soundCursor.current.shot = newest
      latest.current.fireSound(weapon.kind)
    }
  }, [incoming, roomId])

  function hitPeer(target: SceneHit['target'], impulse: MascotImpulse, pop: boolean) {
    if (!roomId || !peerPoint) return
    const hit = { id: ++sequence.current, target, impulse, pop }
    hits.current = [...hits.current.slice(-15), hit]
  }

  function shareSound(kind: SceneSoundKind, strength: number) {
    if (!roomId) return
    sounds.current = [...sounds.current.slice(-15), { id: ++sequence.current, kind, strength }]
  }

  function project(point: Point): Point {
    return {
      x: (peerPoint?.x ?? 0) + (point.x - (incoming?.origin.x ?? 0)) * window.innerWidth,
      y: (peerPoint?.y ?? 0) + (point.y - (incoming?.origin.y ?? 0)) * window.innerHeight,
    }
  }

  return { setToy, hitPeer, shareSound, incoming, project }
}
