import type { FlightFrame, Point } from '../controllers/mascotMotion'

export type MascotPose = 'idle' | 'held' | 'wary' | 'scared'
export type MascotFlight = Pick<FlightFrame, 'edge' | 'squash'> & { velocityX: number }
export type MascotPresence = { position: Point; hat: string; pose: MascotPose; flight: MascotFlight | null }
export type MascotMeetingKind = 'kiss' | 'play' | 'bounce'
export type MascotMeeting = { id: number; position: Point; kind: MascotMeetingKind }
export type MascotRoom = { id: string; peer: string; mascot: MascotPresence | null; meeting: MascotMeeting | null }
export type MascotVisibility = 'hidden' | 'dim' | 'full'
export type MascotPreferences = { remote: MascotVisibility; shareOwn: boolean }
