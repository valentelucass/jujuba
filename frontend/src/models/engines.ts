import sqlServer from '../assets/microsoftsqlserver-original.svg'
import mysql from '../assets/mysql-original.svg'
import postgres from '../assets/postgresql-original.svg'
import sqlite from '../assets/sqlite-original.svg'

export const engines = {
  sqlServer: { name: 'SQL Server', icon: sqlServer, port: 1433 },
  mysql: { name: 'MySQL', icon: mysql, port: 3306 },
  postgres: { name: 'PostgreSQL', icon: postgres, port: 5432 },
  sqlite: { name: 'SQLite', icon: sqlite, port: 0 },
}

export type Engine = keyof typeof engines
export const engineOrder: Engine[] = ['sqlServer', 'mysql', 'postgres', 'sqlite']
