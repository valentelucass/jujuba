import { useCallback, useEffect, useRef, useState } from 'react'
import { appError, sql } from './api'
import { databaseMemoryKey, readDatabaseMemoryHistory, recordDatabaseMemory, type DatabaseMemoryBucket } from './databaseMemoryHistory'
import type { DatabaseMonitorSample } from '../models/databaseMonitor'
import type { AppError, Connection } from '../models/sql'

export const pollMs = 5000
export interface LiveMemoryPoint { time: number; bytes: number | null }
interface Reading {
  sample: DatabaseMonitorSample
  time: number
  memoryKey: string
  live: LiveMemoryPoint[]
  history: DatabaseMemoryBucket[]
}

export function useDatabaseMonitor(connection: Connection, database: string, active: boolean) {
  const [reading, setReading] = useState<Reading | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [busy, setBusy] = useState(false)
  const [paused, setPaused] = useState(false)
  const mode = useRef({ active, paused })
  mode.current = { active, paused }
  const request = useRef<(manual?: boolean) => void>(() => {})
  const refresh = useCallback(() => request.current(true), [])
  const { engine, session, endpoint } = connection
  useEffect(() => {
    let disposed = false
    let pending = false
    let next = 0
    async function read(manual = false) {
      if (disposed || pending || !mode.current.active || document.hidden) return
      if (!manual && (mode.current.paused || Date.now() < next)) return
      pending = true
      setBusy(true)
      try {
        const sample = await sql.monitor({ database, session })
        if (disposed || !mode.current.active || document.hidden || (!manual && mode.current.paused)) return
        const time = Date.now()
        const { label, scope, usedBytes } = sample.memory
        const memoryKey = databaseMemoryKey(engine, endpoint, database, label, scope)
        const bytes = usedBytes !== null && Number.isFinite(usedBytes) && usedBytes >= 0 ? usedBytes : null
        const history = bytes === null ? readDatabaseMemoryHistory(memoryKey, time) : recordDatabaseMemory(memoryKey, time, bytes)
        setReading(previous => {
          const live = previous?.memoryKey === memoryKey ? previous.live.filter(point => point.time >= time - 10 * 60000) : []
          return { sample, time, history, memoryKey, live: [...live, { time, bytes }] }
        })
        setError(null)
        next = time + pollMs
      } catch (cause) {
        if (!disposed) setError(appError(cause))
        next = Date.now() + 30000
      } finally {
        pending = false
        if (!disposed) setBusy(false)
      }
    }
    const wake = () => { void read() }
    request.current = read
    const first = window.setTimeout(wake, 0)
    const interval = window.setInterval(wake, 1000)
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => {
      disposed = true
      request.current = () => {}
      window.clearTimeout(first)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
    }
  }, [engine, endpoint, database, session])
  useEffect(() => {
    if (active && !paused) {
      const resume = window.setTimeout(() => request.current(), 0)
      return () => window.clearTimeout(resume)
    }
  }, [active, paused])
  return { reading, error, busy, paused, setPaused, refresh }
}
