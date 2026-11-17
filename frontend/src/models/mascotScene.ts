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
}
export type SceneHit = { id: number; target: 'main' | 'clone' | `young:${number}`; impulse: MascotImpulse; pop: boolean; peer?: string }
export type SceneSoundKind = 'throw' | 'slimeKick' | 'bounceOffWall' | 'hatch'
export type SceneSound = { id: number; kind: SceneSoundKind; strength: number }
export type GooBurst = { id: number; point: Point; members?: string[] }
export type MascotScene = {
  epoch: number; origin: Point; toy: ToyVisual | null; clone: SharedCompanion | null; young: SharedYoung[]; hits: SceneHit[]; sounds: SceneSound[]
  burst?: GooBurst | null
}

export function mapToy(toy: ToyVisual, project: (point: Point) => Point): ToyVisual {
  return { ...toy, anchor: project(toy.anchor), shoulder: project(toy.shoulder), hand: project(toy.hand),
    shots: toy.shots.map((shot) => ({ ...shot, point: project(shot.point) })),
    sparks: toy.sparks.map((spark) => ({ ...spark, point: project(spark.point) })) }
}
