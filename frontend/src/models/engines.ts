import sqlServer from '../assets/microsoftsqlserver-original.svg'
import mysql from '../assets/mysql-original.svg'
import postgres from '../assets/postgresql-original.svg'
import sqlite from '../assets/sqlite-original.svg'
import mongodb from '../assets/mongodb-original.svg'
import redis from '../assets/redis-original.svg'

export const engines = {
  sqlServer: { name: 'SQL Server', icon: sqlServer, port: 1433 },
  mysql: { name: 'MySQL', icon: mysql, port: 3306 },
  postgres: { name: 'PostgreSQL', icon: postgres, port: 5432 },
  sqlite: { name: 'SQLite', icon: sqlite, port: 0 },
  mongodb: { name: 'MongoDB', icon: mongodb, port: 27017 },
  redis: { name: 'Redis', icon: redis, port: 6379 },
}

export type Engine = keyof typeof engines
export type NoSqlEngine = 'mongodb' | 'redis'
export type SqlEngine = Exclude<Engine, NoSqlEngine>
export const engineOrder: Engine[] = ['sqlServer', 'mysql', 'postgres', 'sqlite', 'mongodb', 'redis']

export function isNoSql(engine: Engine): engine is NoSqlEngine {
  return engine === 'mongodb' || engine === 'redis'
}
