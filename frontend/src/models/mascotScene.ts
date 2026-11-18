import type { Point } from '../controllers/mascotMotion'
import type { MascotFlight, MascotImpulse, MascotMeetingKind, MascotPose } from './flowMascot'

export type ToyKind = 'blaster' | 'bow'
export type SharedShot = { id: number; point: Point; direction: Point; power: number }
export type SharedSpark = { id: number; point: Point; kind: 'muzzle' | 'impact' }
export type ToyVisual = {
  epoch: number; kind: ToyKind; anchor: Point; direction: Point; shoulder: Point; hand: Point
  stretch: number; boost: number; power: number; shots: SharedShot[]; sparks: SharedSpark[]
}
export type SharedCompanion = {
  point: Point; hat: string; pose: MascotPose; flight: MascotFlight | null
  greeting?: MascotMeetingKind | null; direction?: Point | null
}
export type SharedYoung = {
  id: number; point: Point; phase: 'egg' | 'young' | 'popping'; rotation: number; squash: number; held: boolean
  dissolving?: 'egg' | 'young'
}
export type SceneHit = { id: number; target: 'main' | 'clone' | `young:${number}`; impulse: MascotImpulse; pop: boolean; peer?: string }
export type SceneSoundKind = 'throw' | 'slimeKick' | 'bounceOffWall' | 'hatch'
export type SceneSound = { id: number; kind: SceneSoundKind; strength: number }
export type GooBurst = { id: number; point: Point; members?: string[] }
export type GooBombPhase = 'falling' | 'landed' | 'charging' | 'burst'
export type GooSplash = { colors: string[]; bodies: number }
export const gooBombTiming = { landing: 1560, pull: 2210, burst: 4960, end: 7390, stainEnd: 10550 }

const youngTones = [
  ['#f596c2', '#c65394', 0], ['#f8d381', '#ba7827', 83], ['#a8e3c5', '#4c9e81', 184],
  ['#b9acff', '#7669c2', -46], ['#91dfef', '#428fa9', 226], ['#ffa98f', '#d26657', 49],
] as const

export function youngTone(id: number) {
  return youngTones[(id - 1) % youngTones.length]
}
export type MascotScene = {
  epoch: number; origin: Point; toy: ToyVisual | null; clone: SharedCompanion | null; young: SharedYoung[]; hits: SceneHit[]; sounds: SceneSound[]
  burst?: GooBurst | null
}

export function mapToy(toy: ToyVisual, project: (point: Point) => Point): ToyVisual {
  return { ...toy, anchor: project(toy.anchor), shoulder: project(toy.shoulder), hand: project(toy.hand),
    shots: toy.shots.map((shot) => ({ ...shot, point: project(shot.point) })),
    sparks: toy.sparks.map((spark) => ({ ...spark, point: project(spark.point) })) }
}
