import type { ConnectionInput } from '../models/sql'
import type { SqlEngine } from '../models/engines'

type ConnectionPreference = Omit<ConnectionInput, 'password'>
const key = 'nexo.connection.last'

export function readConnectionPreference(): ConnectionPreference {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (saved?.transport === 'local' || saved?.transport === 'network') {
      return {
        transport: saved.transport,
        authentication: saved.authentication === 'windows' ? 'windows' : 'sql',
        host: typeof saved.host === 'string' ? saved.host : undefined,
        port: Number.isInteger(saved.port) && saved.port > 0 && saved.port <= 65535 ? saved.port : undefined,
        instance: typeof saved.instance === 'string' ? saved.instance : undefined,
        username: typeof saved.username === 'string' ? saved.username : undefined,
      }
    }
  } catch { /* Use the default form when storage is unavailable. */ }
  return { transport: 'network', authentication: 'sql' }
}

export function rememberConnection({ transport, authentication, host, port, instance, username }: ConnectionPreference) {
  try {
    localStorage.setItem(key, JSON.stringify({ transport, authentication, host, port, instance, username }))
  } catch { /* A successful connection is usable without saved preferences. */ }
}

type DatabaseEngine = Exclude<SqlEngine, 'sqlServer'>
type DatabasePreference = Pick<ConnectionInput, 'host' | 'port' | 'username' | 'database' | 'path'>

export function readDatabasePreference(engine: DatabaseEngine): DatabasePreference {
  try {
    const saved = JSON.parse(localStorage.getItem(key + '.' + engine) ?? 'null')
    return {
      host: typeof saved?.host === 'string' ? saved.host : undefined,
      port: Number.isInteger(saved?.port) && saved.port > 0 && saved.port <= 65535 ? saved.port : undefined,
      username: typeof saved?.username === 'string' ? saved.username : undefined,
      database: typeof saved?.database === 'string' ? saved.database : undefined,
      path: typeof saved?.path === 'string' ? saved.path : undefined,
    }
  } catch {
    return {}
  }
}

export function rememberDatabase(engine: DatabaseEngine, { host, port, username, database, path }: DatabasePreference) {
  try {
    const profile = engine === 'sqlite' ? { path } : { host, port, username, database }
    localStorage.setItem(key + '.' + engine, JSON.stringify(profile))
  } catch { /* The connection still works without storage. */ }
}
