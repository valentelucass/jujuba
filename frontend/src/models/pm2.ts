export type Pm2Action = 'start' | 'stop' | 'restart' | 'reload' | 'delete'
export type Pm2ShellView = 'shell' | 'logs' | 'describe' | 'monit'
export type Pm2StateAction = 'save' | 'resurrect'
export interface Pm2Process {
  id: number
  name: string
  namespace: string
  status: string
  pid: number | null
  mode: string
  cpu: number | null
  memoryBytes: number | null
  startedAt: number | null
  restarts: number | null
  watching: boolean
  ports: number[] | null
  cwd: string | null
  script: string | null
  version: string | null
}

export interface Pm2Snapshot {
  sampledAt: number
  processes: Pm2Process[]
  host: {
    cpuPercent: number | null
    memoryUsedBytes: number | null
    memoryTotalBytes: number | null
    diskReadBytesPerSec: number | null
    diskWriteBytesPerSec: number | null
  }
}
