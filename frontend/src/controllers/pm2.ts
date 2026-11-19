import { useCallback, useEffect, useRef, useState } from 'react'
import type { Pm2Action, Pm2HostSample, Pm2ShellView, Pm2Snapshot, Pm2StateAction } from '../models/pm2'
import type { AppError } from '../models/sql'
import { appError, call } from './api'

const interval = 3000
const historyLimit = 100
let pending: Promise<Pm2Snapshot> | null = null

const hostRequests = new Map<boolean, Promise<Pm2HostSample>>()

export const pm2 = {
  snapshot() {
    pending ??= call<Pm2Snapshot>('pm2_snapshot', { includeHost: false }).finally(() => { pending = null })
    return pending
  },
  hostSnapshot(inspectDisk: boolean) {
    const pendingHost = hostRequests.get(inspectDisk)
    if (pendingHost) return pendingHost
    const request = call<Pm2HostSample>('host_snapshot', { inspectDisk })
      .finally(() => hostRequests.delete(inspectDisk))
    hostRequests.set(inspectDisk, request)
    return request
  },
  action: (id: number, name: string, action: Pm2Action) => call<void>('pm2_action', { id, name, action }),
  openShell: (id: number, name: string, view: Pm2ShellView) => call<void>('pm2_open_shell', { id, name, view }),
  scale: (id: number, name: string, instances: number) => call<void>('pm2_scale', { id, name, instances }),
  stateAction: (action: Pm2StateAction) => call<void>('pm2_state_action', { action }),
  startFile: () => call<boolean>('pm2_start_file'),
}

function useSamples<T extends { sampledAt: number }>(active: boolean, readSample: () => Promise<T>, now: number) {
  const [history, setHistory] = useState<T[]>([])
  const [error, setError] = useState<AppError | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useRef<() => void>(() => {})
  useEffect(() => {
    if (!active) return
    let disposed = false
    let reading = false
    let queued = false
    let timer: ReturnType<typeof setTimeout>
    async function read() {
      if (reading) { queued = true; return }
      clearTimeout(timer)
      reading = true
      setRefreshing(true)
      try {
        const sample = await readSample()
        if (disposed) return
        setHistory((previous) => {
          const last = previous.at(-1)
          if (last && sample.sampledAt < last.sampledAt) return [sample]
          const retained = previous.filter((item) => item.sampledAt < sample.sampledAt && sample.sampledAt - item.sampledAt <= interval * historyLimit)
          return [...retained.slice(1 - historyLimit), sample]
        })
        setError(null)
      } catch (failure) {
        if (!disposed) setError(appError(failure))
      } finally {
        reading = false
        if (!disposed) {
          setRefreshing(false)
          timer = setTimeout(read, queued ? 0 : interval)
          queued = false
        }
      }
    }
    refresh.current = () => void read()
    void read()
    return () => {
      disposed = true
      refresh.current = () => {}
      clearTimeout(timer)
    }
  }, [active, readSample])
  const latest = history.at(-1)
  return { history, latest, now, error, refreshing, refresh: () => refresh.current(),
    stale: !!latest && (!!error || now - latest.sampledAt > 4 * interval) }
}

export function usePm2Monitor(active: boolean, inspectDisk: boolean) {
  const [visible, setVisible] = useState(() => !document.hidden)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const changed = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  const polling = active && visible
  useEffect(() => {
    if (!polling) return
    setNow(Date.now())
    const clock = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(clock)
  }, [polling])
  const readHost = useCallback(() => pm2.hostSnapshot(inspectDisk), [inspectDisk])
  const processes = useSamples(polling, pm2.snapshot, now)
  const computer = useSamples(polling, readHost, now)
  return { ...processes, computer, refresh() { processes.refresh(); computer.refresh() } }
}
