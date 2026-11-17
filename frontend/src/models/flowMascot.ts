import type { FlightFrame, Impact, Point } from '../controllers/mascotMotion'

export type MascotPose = 'idle' | 'held' | 'wary' | 'scared'
export type MascotFlight = Pick<FlightFrame, 'edge' | 'squash'> & { velocityX: number }
export type MascotPresence = { position: Point; hat: string; pose: MascotPose; flight: MascotFlight | null }
export type MascotMeetingKind = 'kiss' | 'play' | 'bounce' | 'hug' | 'squeeze' | 'look' | 'dance' | 'push' | 'bump'
export type MascotImpulse = { direction: Point; strength: number }
export type MascotMeeting = { id: number; position: Point; kind: MascotMeetingKind; impulse?: MascotImpulse }
export type MascotSplat = Omit<Impact, keyof Point> & { id: number; position: Point }
export type MascotRoom = { id: string; peer: string; host: boolean; rich: boolean; mascot: MascotPresence | null; meeting: MascotMeeting | null; splats: MascotSplat[] }
export type MascotVisibility = 'hidden' | 'dim' | 'full'
export type MascotPreferences = { remote: MascotVisibility; shareOwn: boolean }
