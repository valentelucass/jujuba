export interface EngineDashboardData {
  metrics: { label: string; value: number; unit: 'count' | 'bytes' | 'perSecond' }[]
  tables: { name: string; bytes: number }[]
  partial: boolean
}

export interface DatabaseFile {
  name: string
  kind: string
  sizeMib: number
  usedMib: number | null
}

export interface DashboardOverview {
  tables: number
  views: number
  schemas: number
  foreignKeys: number
  files: DatabaseFile[]
}

export interface TableStorage {
  id: number
  schema: string
  name: string
  rows: number
  reservedBytes: string
  usedBytes: string
}

export interface ColumnStorage {
  method: 'full' | 'sample' | 'limited' | 'unavailable'
  measuredRows: string
  catalogRows: string | null
  columns: {
    name: string
    dataType: string
    measuredBytes: string | null
    reason: string | null
  }[]
}

export interface QueryActivity {
  label: string
  executions: number
  averageMs: number
  totalMs: number
  sqlPreview: string | null
}

export interface DashboardPerformance {
  state: string
  timeline: QueryActivity[]
  queries: QueryActivity[]
}

export interface LiveActivity {
  total: number
  waiting: number
  blocked: number
  waits: { name: string; count: number }[]
  requests: {
    sessionId: number
    requestId: number
    status: string
    command: string
    elapsedMs: number
    cpuMs: number
    waitType: string | null
    waitMs: number
    blocker: number
  }[]
  files: {
    name: string
    reads: number
    writes: number
    readMib: number
    writtenMib: number
    readWaitMs: number
    writeWaitMs: number
  }[]
}
