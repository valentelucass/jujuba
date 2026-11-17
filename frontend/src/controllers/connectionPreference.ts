import type { ConnectionInput } from '../models/sql'
import { engineOrder, isNoSql, type Engine, type SqlEngine } from '../models/engines'
import { noSql, sql } from './api'

type ConnectionPreference = Omit<ConnectionInput, 'password'>
const key = 'nexo.connection.last'
const sessionKey = 'jujuba.connection.session'

export interface SessionPreference {
  engine: Engine
  database: string | null
  resume: boolean
}

export function readSessionPreference(): SessionPreference | null {
  try {
    const session = JSON.parse(localStorage.getItem(sessionKey) ?? 'null')
    if (!engineOrder.includes(session?.engine)) return null
    return {
      engine: session.engine,
      database: typeof session.database === 'string' ? session.database : null,
      resume: session.resume === true,
    }
  } catch { return null }
}

export function rememberSession(session: SessionPreference) {
  try { localStorage.setItem(sessionKey, JSON.stringify(session)) } catch { /* The connection remains usable. */ }
}

export function rememberActiveDatabase(engine: Engine, database: string | null) {
  const session = readSessionPreference()
  if (session?.resume && session.engine === engine) rememberSession({ ...session, database })
}

export function activeDatabase(engine: Engine, databases: string[]): string | null {
  const session = readSessionPreference()
  return session?.engine === engine && session.database && databases.includes(session.database)
    ? session.database
    : null
}

export async function getSavedConnection(engine: Engine) {
  if (isNoSql(engine)) {
    return await noSql.hasSavedUri(engine) ? () => noSql.connect(engine, undefined, true) : null
  }
  const profile: ConnectionPreference = engine === 'sqlServer'
    ? { engine, ...readConnectionPreference() }
    : { engine, transport: engine === 'sqlite' ? 'local' : 'network', authentication: 'sql', ...readDatabasePreference(engine) }
  if (engine === 'sqlite') return profile.path ? () => sql.connect(profile, false) : null
  if (profile.transport === 'network' && (!profile.host || !profile.port)) return null
  if (profile.authentication === 'windows') return () => sql.connect(profile, false)
  return profile.username && await sql.hasSavedPassword(profile) ? () => sql.connect(profile, true) : null
}

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
