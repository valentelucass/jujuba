import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { FlightFrame, Point } from './mascotMotion'
import type { Offspring } from './useMascotBrood'
import type { FlowParticipant, MascotImpulse, MascotMeetingKind, MascotRoom } from '../models/flowMascot'
import type { VisibleMascot } from './useSharedMascot'
import { mapToy, type GooBurst, type MascotScene, type SceneHit, type SceneSound, type SceneSoundKind, type ToyKind, type ToyVisual } from '../models/mascotScene'

type Companion = { point: Point | null; held: boolean; flight: FlightFrame | null; greeting?: MascotMeetingKind; direction: Point }
const normal = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 10000) / 10000
export const normalizeScene = (point: Point): Point => ({ x: normal(point.x / window.innerWidth), y: normal(point.y / window.innerHeight) })

function coordinates(origin: Point, at: Point) {
  return {
    project: (point: Point) => ({
      x: at.x + (point.x - origin.x) * window.innerWidth,
      y: at.y + (point.y - origin.y) * window.innerHeight,
    }),
    unproject: (point: Point) => ({
      x: normal(origin.x + (point.x - at.x) / window.innerWidth),
      y: normal(origin.y + (point.y - at.y) / window.innerHeight),
    }),
  }
}

function sceneCoordinates({ appearance }: VisibleMascot) {
  return coordinates(appearance.scene!.origin, { x: appearance.point.x + 33, y: appearance.point.y + 33 })
}

type Seen = { epoch: number; hit: number; sound: number; shot: number; weapon: number; burst: number }

export function useMascotScene(outgoing: RefObject<(() => MascotScene) | null>, {
  room, own, clone, hat, children, childPosition, members, visible, active, receiveHit, fireSound, receiveBurst,
}: {
  room: MascotRoom | null; own: Point; clone: Companion; hat: string; children: Offspring[]
  childPosition: (child: Offspring) => Point; members: FlowParticipant[]; visible: VisibleMascot[]; active: boolean
  receiveHit: (hit: SceneHit) => void; fireSound: (kind: ToyKind | SceneSoundKind, strength?: number) => void
  receiveBurst: (point: Point, affectsOwn: boolean, source: string) => void
}) {
  const toy = useRef<ToyVisual | null>(null)
  const hits = useRef<SceneHit[]>([])
  const sounds = useRef<SceneSound[]>([])
  const burst = useRef<GooBurst | null>(null)
  const sequence = useRef(0)
  const epoch = useRef(0)
  const seen = useRef(new Map<string, Seen>())
  const latest = useRef({ own, clone, hat, children, childPosition, receiveHit, fireSound, receiveBurst })
  latest.current = { own, clone, hat, children, childPosition, receiveHit, fireSound, receiveBurst }
  const roomId = room?.id

  const setToy = useCallback((next: ToyVisual | null) => { toy.current = next }, [])

  useEffect(() => {
    hits.current = []
    sounds.current = []
    burst.current = null
    epoch.current = crypto.getRandomValues(new Uint32Array(1))[0] || 1
    seen.current.clear()
    if (!roomId) {
      outgoing.current = null
      return
    }
    outgoing.current = () => {
      const { own, clone, hat, children, childPosition } = latest.current
      return {
        epoch: epoch.current, origin: normalizeScene(own), toy: toy.current ? mapToy(toy.current, normalizeScene) : null,
        clone: clone.point ? { point: normalizeScene({ x: clone.point.x + 33, y: clone.point.y + 33 }), hat,
          pose: clone.held ? 'held' : 'idle', greeting: clone.greeting, direction: clone.direction, flight: clone.flight ? {
            edge: clone.flight.edge, squash: clone.flight.squash, velocityX: clone.flight.velocity.x,
          } : null } : null,
        young: children.map((child) => ({
          id: child.id, point: normalizeScene(childPosition(child)), phase: child.phase, held: !!child.held,
          rotation: Math.round((child.flight?.velocity.x ?? 0) / 9.5) / 10,
          squash: Math.round((child.flight?.squash ?? 0) * 100) / 100,
          dissolving: child.dissolving,
        })),
        hits: hits.current, sounds: sounds.current, burst: burst.current,
      }
    }
    return () => { outgoing.current = null }
  }, [roomId, outgoing])

  const scenes = visible.flatMap((entry) => entry.appearance.scene
    ? [{ ...entry, scene: entry.appearance.scene, ...sceneCoordinates(entry) }] : [])

  useEffect(() => {
    for (const member of members) {
      const incoming = member.mascot?.scene
      if (!incoming) continue
      const representation = scenes.find(({ member: entry }) => entry.id === member.id)
      const previous = seen.current.get(member.id)
      const weapon = incoming.toy
      const latestShot = Math.max(0, ...(weapon?.shots ?? []).map(({ id }) => id))
      const next = {
        epoch: incoming.epoch, hit: Math.max(0, ...incoming.hits.map(({ id }) => id)),
        sound: Math.max(0, ...(incoming.sounds ?? []).map(({ id }) => id)), shot: latestShot,
        weapon: weapon?.epoch ?? 0, burst: incoming.burst?.id ?? 0,
      }
      if (previous?.epoch === next.epoch) {
        next.hit = Math.max(next.hit, previous.hit)
        next.sound = Math.max(next.sound, previous.sound)
        next.burst = Math.max(next.burst, previous.burst)
        if (previous.weapon === next.weapon) next.shot = Math.max(next.shot, previous.shot)
      }
      seen.current.set(member.id, next)
      if (!representation) continue
      const last = previous?.epoch === incoming.epoch ? previous : undefined
      for (const hit of incoming.hits) {
        const mine = hit.peer ? hit.peer === room?.selfId : !room?.selfId || (room.host && !member.group)
        if (active && mine && hit.id > (last?.hit ?? 0)) latest.current.receiveHit(hit)
      }
      for (const sound of incoming.sounds ?? []) {
        if (sound.id > (last?.sound ?? 0)) latest.current.fireSound(sound.kind, sound.strength)
      }
      if (weapon && latestShot > (last?.weapon === weapon.epoch ? last.shot : 0)) latest.current.fireSound(weapon.kind)
      if (incoming.burst && incoming.burst.id > (last?.burst ?? 0)) {
        const affectsOwn = active && (!incoming.burst.members || !!room?.selfId && incoming.burst.members.includes(room.selfId))
        latest.current.receiveBurst(representation.project(incoming.burst.point), affectsOwn, member.id)
      }
    }
  }, [members, scenes, roomId, active])

  function hitPeer(target: SceneHit['target'], impulse: MascotImpulse, pop: boolean, peer: string) {
    if (!roomId || !active || !visible.some(({ member }) => member.id === peer)) return
    const hit = { id: ++sequence.current, target, impulse, pop, peer: room?.selfId ? peer : undefined }
    hits.current = [...hits.current.slice(-15), hit]
  }

  function shareSound(kind: SceneSoundKind, strength: number) {
    if (!roomId || !active) return
    sounds.current = [...sounds.current.slice(-15), { id: ++sequence.current, kind, strength }]
  }

  function setBurst(point: Point) {
    if (!roomId || !active) return
    const event = { id: ++sequence.current, point: normalizeScene(point),
      members: room?.selfId ? visible.map(({ member }) => member.id) : undefined }
    burst.current = event
    window.setTimeout(() => { if (burst.current === event) burst.current = null }, 1900)
  }

  return { setToy, hitPeer, shareSound, setBurst, scenes }
}
