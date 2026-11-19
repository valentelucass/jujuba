import type { FlightFrame, Impact, Point } from '../controllers/mascotMotion'
import type { MascotScene } from './mascotScene'

export type MascotPose = 'idle' | 'held' | 'wary' | 'scared'
export type MascotFlight = Pick<FlightFrame, 'edge' | 'squash'> & { velocityX: number }
export type MascotPresence = { position: Point; hat: string; color?: string; pose: MascotPose; flight: MascotFlight | null; scene?: MascotScene | null }
export type MascotMeetingKind = 'kiss' | 'play' | 'bounce' | 'hug' | 'squeeze' | 'look' | 'dance' | 'push' | 'bump'
export type MascotImpulse = { direction: Point; strength: number }
export type MascotMeeting = { id: number; position: Point; kind: MascotMeetingKind; impulse?: MascotImpulse; peer?: string }
export type MascotSplat = Omit<Impact, keyof Point> & { id: number; position: Point }
export type ChildDrag = { id: number; kind: 'grab' | 'move' | 'release'; point: Point; velocity?: Point }
export type RoutedDrag = { sequence: number; from: string; drag: ChildDrag }
export type FlowParticipant = {
  id: string; name: string; version?: string | null; group: boolean; cursor: Point | null
  mascot: MascotPresence | null; meeting: MascotMeeting | null; splats: MascotSplat[]
}
export type MascotRoom = {
  id: string; peer: string; host: boolean; rich: boolean; mascot: MascotPresence | null; meeting: MascotMeeting | null
  splats: MascotSplat[]; selfId?: string | null; members?: FlowParticipant[]; childDrags?: RoutedDrag[]
}
export type MascotVisibility = 'hidden' | 'dim' | 'full'
export type MascotPreferences = { remote: MascotVisibility; shareOwn: boolean; paused: boolean; byPeer: Record<string, MascotVisibility> }
