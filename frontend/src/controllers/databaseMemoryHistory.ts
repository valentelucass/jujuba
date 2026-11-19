const periodMs = 5 * 60_000
const retentionMs = 7 * 24 * 60 * 60_000
const prefix = 'jujuba.db-monitor.memory.v1:'
const indexKey = prefix + 'connections'
const maximumScopes = 12

export interface DatabaseMemoryBucket {
  time: number
  firstAt: number
  lastAt: number
  averageBytes: number
  peakBytes: number
  samples: number
}

export function databaseMemoryKey(engine: string, endpoint: string, database: string, label: string, scope: string) {
  return JSON.stringify([engine, endpoint, database, label, scope])
}

const sessions = new Map<string, DatabaseMemoryBucket[]>()

function recent(bucket: DatabaseMemoryBucket, now: number) {
  return bucket && Number.isSafeInteger(bucket.time) && bucket.time % periodMs === 0
    && Number.isSafeInteger(bucket.firstAt) && Number.isSafeInteger(bucket.lastAt)
    && bucket.firstAt >= bucket.time && bucket.firstAt <= bucket.lastAt && bucket.lastAt < bucket.time + periodMs
    && bucket.firstAt >= now - retentionMs && bucket.lastAt <= now
    && Number.isSafeInteger(bucket.samples) && bucket.samples > 0
    && Number.isFinite(bucket.averageBytes) && Number.isFinite(bucket.peakBytes)
    && bucket.averageBytes >= 0 && bucket.peakBytes >= bucket.averageBytes
}

export function readDatabaseMemoryHistory(key: string, now = Date.now()): DatabaseMemoryBucket[] {
  let buckets = sessions.get(key)
  if (!buckets && !key.startsWith('volatile:')) {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(prefix + key) ?? '[]')
      if (Array.isArray(saved)) buckets = saved
    } catch { /* History is optional when storage is unavailable. */ }
  }
  return (buckets ?? []).filter(bucket => recent(bucket, now))
}

export function recordDatabaseMemory(key: string, time: number, usedBytes: number): DatabaseMemoryBucket[] {
  const buckets = readDatabaseMemoryHistory(key, time)
  if (!Number.isSafeInteger(time) || !Number.isFinite(usedBytes) || usedBytes < 0) return buckets
  const start = Math.floor(time / periodMs) * periodMs
  const last = buckets.at(-1)
  if (last && last.time === start) {
    if (time <= last.lastAt) return buckets
    buckets[buckets.length - 1] = { ...last, lastAt: time, samples: last.samples + 1,
      peakBytes: Math.max(last.peakBytes, usedBytes),
      averageBytes: last.averageBytes + (usedBytes - last.averageBytes) / (last.samples + 1) }
  } else {
    buckets.push({ time: start, firstAt: time, lastAt: time, averageBytes: usedBytes, peakBytes: usedBytes, samples: 1 })
  }
  sessions.delete(key)
  sessions.set(key, buckets)
  if (sessions.size > maximumScopes) sessions.delete(sessions.keys().next().value!)
  if (!key.startsWith('volatile:')) {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(indexKey) ?? '[]')
      const keys: string[] = Array.isArray(stored) ? stored.filter(k => typeof k === 'string' && k !== key) : []
      keys.push(key)
      while (keys.length > maximumScopes) localStorage.removeItem(prefix + keys.shift())
      localStorage.setItem(indexKey, JSON.stringify(keys))
      localStorage.setItem(prefix + key, JSON.stringify(buckets))
    } catch { /* The current window still has its samples. */ }
  }
  return buckets
}
