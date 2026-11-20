export interface MemoryMetric {
  label: string
  scope: string
  usedBytes: number | null
  limitBytes: number | null
  limitLabel: string
  nativePeakBytes: number | null
  nativePeakLabel: string
}

export type MetricUnit = 'bytes' | 'count' | 'percent' | 'seconds' | 'milliseconds'
export interface DatabaseActivity {
  database?: string | null
  lastRequestEnd?: string | null
  id: string
  application: string | null
  client: string | null
  operation: string | null
  state: string | null
  object: string | null
  elapsedMs: number | null
}

export interface DatabaseMonitorSample {
  sqlServer?: {
    hostMemoryLow: boolean | null
    processMemoryLow: boolean | null
    waitingForMemory: number | null
    fullVisibility: boolean
    databaseCount: number | null
    instanceCount: number | null
    instanceRows: DatabaseActivity[]
    objectsAvailable: boolean
  }
  memory: MemoryMetric
  indicators: { label: string; value: number; unit: MetricUnit; scope: string }[]
  activity: DatabaseActivity[]
  objects: { name: string; metric: string; value: number; unit: 'count' | 'bytes'; window: string
    usage?: { reads: number; updates: number; lastAccess: string | null } }[]
  notes: string[]
}
