import { invoke, isTauri } from '@tauri-apps/api/core'
import type { AiProvider, AssistantReply, AssistantRequest, DiagramProject, GeneratedProject, OpenedDiagram, SystemDiagram } from '../models/systemDiagram'
import type { FlowCommand, FlowProject, FlowProjectEntry, FlowSession, FlowViewUpdate } from '../models/flowWorkspace'
import type { NoSqlEngine } from '../models/engines'
import type { DocumentsPage, RedisEntry, RedisKeys } from '../models/noSql'
import type { DatabaseFile, DashboardOverview, DashboardPerformance, EngineDashboardData, LiveActivity, TableStorage } from '../models/dashboard'
import type {
  AppError, Connection, ConnectionInput, DatabaseDiagram, EditInput, QueryOutput, PageRequest, RecordsPage, Relationship,
  Schema, Scope, Structure, Table, TableScope,
} from '../models/sql'

async function call<T>(command: string, args?: Record<string, unknown> | Uint8Array): Promise<T> {
  if (!isTauri()) {
    throw { kind: 'desktop', message: 'Abra o JujubaSQL pelo aplicativo instalado no Windows.' }
  }
  return invoke<T>(command, args)
}

export const sql = {
  connect: (input: ConnectionInput, useSaved: boolean) =>
    call<Connection>('connect', { input, useSaved }),
  hasSavedPassword: (input: Omit<ConnectionInput, 'password'>) => call<boolean>('has_saved_password', { input }),
  forgetPassword: (input: Omit<ConnectionInput, 'password'>) => call<void>('forget_password', { input }),
  disconnect: () => call<void>('disconnect'),
  schemas: (scope: Scope) => call<Schema[]>('schemas', { scope }),
  tables: (scope: Scope, schema: Schema) => call<Table[]>('tables', { scope, schema }),
  structure: (scope: TableScope) => call<Structure>('structure', { scope }),
  records: (scope: TableScope, page: PageRequest) =>
    call<RecordsPage>('records', { input: { ...scope, ...page } }),
  queryRead: (scope: Scope, source: string) => call<QueryOutput>('query_read', { scope, source }),
  updateCell: (input: EditInput) => call<{ changed: boolean }>('update_cell', { input }),
  databaseDiagram: (scope: Scope) => call<DatabaseDiagram>('database_diagram', { scope }),
  engineDashboard: (scope: Scope) => call<EngineDashboardData>('dashboard_engine', { scope }),
  dashboardOverview: (scope: Scope) => call<DashboardOverview>('dashboard_overview', { scope }),
  dashboardLive: (scope: Scope) => call<LiveActivity>('dashboard_live', { scope }),
  dashboardStorage: (scope: Scope) => call<TableStorage[]>('dashboard_storage', { scope }),
  dashboardFiles: (scope: Scope) => call<DatabaseFile[]>('dashboard_files', { scope }),
  dashboardPerformance: (scope: Scope, hours: number) =>
    call<DashboardPerformance>('dashboard_performance', { scope, hours }),
  relationships: (scope: TableScope) => call<Relationship[]>('relationships', { scope }),
}

export const noSql = {
  connect: (engine: NoSqlEngine, uri: string | undefined, useSaved: boolean) =>
    call<Connection>('connect_nosql', { engine, uri, useSaved }),
  hasSavedUri: (engine: NoSqlEngine) => call<boolean>('has_saved_uri', { engine }),
  forgetUri: (engine: NoSqlEngine) => call<void>('forget_uri', { engine }),
  collections: (scope: Scope) => call<string[]>('mongo_collections', { scope }),
  documents: (scope: Scope, collection: string, filter: string, page: number) =>
    call<DocumentsPage>('mongo_documents', { scope, collection, filter, page }),
  keys: (scope: Scope, cursor: string, pattern: string) => call<RedisKeys>('redis_keys', { scope, cursor, pattern }),
  entry: (scope: Scope, id: string) => call<RedisEntry>('redis_entry', { scope, id }),
}

export const systemDiagram = {
  checkAgent: (provider: AiProvider) => call<void>('diagram_agent', { provider }),
  chooseWorkspace: () => call<string | null>('diagram_choose_workspace'),
  converse: (provider: AiProvider, request: AssistantRequest) => call<AssistantReply>('assistant_converse', { provider, request }),
  open: () => call<OpenedDiagram | null>('diagram_open'),
  save: (diagram: SystemDiagram, project: DiagramProject | null) =>
    call<DiagramProject | null>('diagram_save', { diagram, project }),
  png: (bytes: Uint8Array) => call<string | null>('diagram_png', bytes),
  markdown: (diagram: SystemDiagram) => call<string | null>('diagram_markdown', { diagram }),
  scaffold: (provider: AiProvider, project: DiagramProject, requirements: string) =>
    call<GeneratedProject>('diagram_scaffold', { provider, project, requirements }),
  writeCode: (code: GeneratedProject) => call<string | null>('diagram_write_code', { code }),
}

export const flowProjects = {
  list: () => call<FlowProjectEntry[]>('flow_projects'),
  load: (id: string) => call<FlowProject>('flow_project_load', { id }),
  create: (diagram: SystemDiagram, file: DiagramProject | null) => call<FlowProject>('flow_project_create', { diagram, file }),
  edit: (id: string, diagram: SystemDiagram) => call<void>('flow_project_edit', { id, diagram }),
  link: (id: string, file: DiagramProject, diagram: SystemDiagram) => call<void>('flow_project_link', { id, file, diagram }),
  remove: (id: string) => call<void>('flow_project_remove', { id }),
}

export const flowCollaboration = {
  host: (id: string, name?: string, resumeInvite?: boolean) => call<FlowSession>('flow_collab_host', { id, name, resumeInvite }),
  join: (code: string, name: string) => call<FlowSession>('flow_collab_join', { code, name }),
  view: (id: string, seen: number, known?: number) => call<FlowViewUpdate | null>('flow_collab_view', { id, seen, known }),
  command: (id: string, command: FlowCommand) => call<void>('flow_collab_command', { id, command }),
  end: (id: string) => call<void>('flow_collab_end', { id }),
}

export function appError(error: unknown): AppError {
  if (typeof error === 'object' && error && 'kind' in error && 'message' in error
      && typeof error.kind === 'string' && typeof error.message === 'string') {
    return { kind: error.kind, message: error.message }
  }
  return { kind: 'application', message: 'O aplicativo não conseguiu concluir a leitura.' }
}
