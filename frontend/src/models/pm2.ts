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

export type HostResource = 'cpu' | 'memory' | 'gpu' | 'disk'
export interface HostRank {
  status: 'ready' | 'warming' | 'unavailable'
  basis: 'cpuCapacity' | 'physicalMemory' | 'gpuEngine' | 'diskActivity' | 'processIo'
  rows: { pid: number; name: string; value: number; percent: number }[]
}

export interface Pm2Host {
  cpuPercent: number | null
  memoryUsedBytes: number | null
  memoryTotalBytes: number | null
  diskReadBytesPerSec: number | null
  diskWriteBytesPerSec: number | null
  gpuPercent?: number | null
  consumers?: Partial<Record<HostResource, HostRank>>
}

export interface Pm2HostSample {
  sampledAt: number
  host: Pm2Host
}

export interface Pm2Snapshot {
  sampledAt: number
  host?: Pm2Host
  processes: Pm2Process[]
}
