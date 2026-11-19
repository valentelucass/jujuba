export interface MemoryMetric {
  label: string
  scope: string
  usedBytes: number | null
  limitBytes: number | null
  limitLabel: string
  nativePeakBytes: number | null
  nativePeakLabel: string
}

export type MetricUnit = 'bytes' | 'count' | 'percent' | 'seconds'
export interface DatabaseActivity {
  id: string
  application: string | null
  client: string | null
  operation: string | null
  state: string | null
  object: string | null
  elapsedMs: number | null
}

export interface DatabaseMonitorSample {
  memory: MemoryMetric
  indicators: { label: string; value: number; unit: MetricUnit; scope: string }[]
  activity: DatabaseActivity[]
  objects: { name: string; metric: string; value: number; unit: 'count' | 'bytes'; window: string }[]
  notes: string[]
}
