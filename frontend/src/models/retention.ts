export type RetentionMode = 'own' | 'keep' | 'inherit'
export interface RetentionEntity {
  name: string
  mode: RetentionMode
  days: number | null
  supported: boolean
}
export type RetentionCatalog = { available: false } | {
  available: true
  defaultDays: number | null
  revision: string
  canConfigure: boolean
  entities: RetentionEntity[]
}
export interface RetentionDay {
  day: string
  currentRows: number
  sourceRows: number
  removedRows: number
  removedBytes?: string | null
  removed: boolean
  held: boolean
}
export type RetentionPreview = { available: false } | {
  available: true
  today: string
  cutoff: string | null
  revision: string
  days: RetentionDay[]
}
