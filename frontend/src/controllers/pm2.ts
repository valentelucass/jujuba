import { useEffect, useRef, useState } from 'react'
import type { Pm2Action, Pm2ShellView, Pm2Snapshot, Pm2StateAction } from '../models/pm2'
import type { AppError } from '../models/sql'
import { appError, call } from './api'

const interval = 3000
const historyLimit = 100
let pending: Promise<Pm2Snapshot> | null = null

export const pm2 = {
  snapshot() {
    pending ??= call<Pm2Snapshot>('pm2_snapshot').finally(() => { pending = null })
    return pending
  },
  action: (id: number, name: string, action: Pm2Action) => call<void>('pm2_action', { id, name, action }),
  openShell: (id: number, name: string, view: Pm2ShellView) => call<void>('pm2_open_shell', { id, name, view }),
  scale: (id: number, name: string, instances: number) => call<void>('pm2_scale', { id, name, instances }),
  stateAction: (action: Pm2StateAction) => call<void>('pm2_state_action', { action }),
  startFile: () => call<boolean>('pm2_start_file'),
}

export function usePm2Monitor(active: boolean) {
  const [history, setHistory] = useState<Pm2Snapshot[]>([])
  const [error, setError] = useState<AppError | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [visible, setVisible] = useState(() => !document.hidden)
  const [now, setNow] = useState(Date.now)
  const refresh = useRef<() => void>(() => {})
  useEffect(() => {
    const changed = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  useEffect(() => {
    if (!active || !visible) return
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
        const sample = await pm2.snapshot()
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
          setNow(Date.now())
          timer = setTimeout(read, queued ? 0 : interval)
          queued = false
        }
      }
    }
    refresh.current = () => void read()
    void read()
    const clock = setInterval(() => setNow(Date.now()), interval)
    return () => {
      disposed = true
      refresh.current = () => {}
      clearTimeout(timer)
      clearInterval(clock)
    }
  }, [active, visible])
  const latest = history.at(-1)
  return { history, latest, now, error, refreshing, refresh: () => refresh.current(),
    stale: !!latest && (!!error || now - latest.sampledAt > 4 * interval) }
}
