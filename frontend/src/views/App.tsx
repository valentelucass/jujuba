import { lazy, Suspense, useCallback, useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDownRight, ArrowRight, Braces, ChartNoAxesCombined, ChevronRight, Database as DatabaseIcon, GitFork, KeyRound,
  PanelRight, Plug, RefreshCw, Search, Table2 } from 'lucide-react'
import { sql } from '../controllers/api'
import { useExplorer } from '../controllers/useExplorer'
import { useTable } from '../controllers/useTable'
import type { Connection, Database, Relationship, Scope, Structure as TableStructure, Tab, Table, TableScope } from '../models/sql'
import { CenterEnginePicker, SelectedEngine } from './EnginePicker'
import { OtherConnectionForm } from './OtherConnectionForm'
import { NoSqlConnectionForm } from './NoSqlConnectionForm'
import { NoSqlStudio } from './NoSqlStudio'
import { engines, isNoSql, type Engine } from '../models/engines'
import { ConnectionForm } from './ConnectionForm'
import jujuba from '../assets/jujuba.png'
import { Diagram, Graph } from './Diagram'
import { useRemote } from '../controllers/useRemote'
import { StudioLayout } from './StudioLayout'
import { Header } from './Header'
import { Records } from './Records'
import { Empty, Failure, Loading } from './States'
import { Structure } from './Structure'
import { StatusBar } from './StatusBar'
import { AssistantDock, readProvider } from './AssistantDock'
import type { SystemDiagram } from '../models/systemDiagram'
const SqlEditor = lazy(() => import('./SqlEditor').then((module) => ({ default: module.SqlEditor })))
const DatabaseDashboard = lazy(() => import('./DatabaseDashboard'))
const SystemDiagramStudio = lazy(() => import('./SystemDiagramStudio').then((module) => ({ default: module.SystemDiagramStudio })))

function Details({ children }: { children: ReactNode }) {
  return <aside className="details"><div className="panel-title"><PanelRight size={15} /><h2>Detalhes</h2></div>
    <div className="details-body">{children}</div></aside>
}

function ConnectionDetails({ connection, database }: { connection: Connection; database?: Database | null }) {
  const engine = engines[connection.engine]
  return <Details>
    <div className="details-heading"><span className="engine-icon"><img src={engine.icon} alt="" /></span>
      <div><h3>Conexão {engine.name}</h3><p>Sessão ativa</p></div></div>
    <dl>
      <dt>{connection.engine === 'sqlite' ? 'Arquivo' : 'Servidor'}</dt><dd>{connection.endpoint}</dd>
      {database && <><dt>Banco</dt><dd>{database}</dd></>}
      <dt>Modo</dt><dd>{connection.engine === 'sqlServer' ? 'Consulta e edição conforme permissões' : 'Consulta'}</dd>
      <dt>Segurança</dt><dd>{connection.engine === 'sqlite' ? 'Arquivo aberto em modo de leitura' :
        connection.transport === 'local' ? 'Conexão direta neste computador' : 'TLS com certificado validado'}</dd>
    </dl>
  </Details>
}

const cardinalityDescriptions: Record<string, string> = {
  '1': 'exatamente um',
  '0..1': 'zero ou um',
  '0..N': 'zero, um ou vários',
}

function CardinalityDetail({ label, value }: { label: string; value: string | null }) {
  return <div className="cardinality-detail"><code>{value ?? '?'}</code>
    <div><strong>{label}</strong><small>{value ? cardinalityDescriptions[value] ?? value : 'Indeterminada'}</small></div>
  </div>
}

function ObjectDetails({ table, database, metadata, relation, onTable }: {
  table: Table; database: Database; metadata?: TableStructure; relation: Relationship | null
  onTable: (table: Table) => void
}) {
  if (!relation) return <Details>
    <div className="details-heading"><span className="quiet-icon"><Table2 size={17} /></span>
      <div><h3 title={table.name}>{table.name}</h3><p>Tabela</p></div></div>
    <dl><dt>Banco</dt><dd>{database}</dd><dt>Esquema</dt><dd>{table.schema}</dd>
      {metadata && <><dt>Colunas visíveis</dt><dd>{metadata.columns.length}</dd>
        <dt>Índices visíveis</dt><dd>{metadata.indexes.length}</dd>
        <dt>Chave primária</dt><dd>{metadata.columns.filter((column) => column.primaryKey).map((column) => column.name).join(', ') || 'Nenhuma visível'}</dd></>}
    </dl>
  </Details>
  return <Details>
    <div className="details-heading"><span className="quiet-icon accent-icon"><GitFork size={18} /></span>
      <div><h3>Chave estrangeira</h3><p>{relation.name}</p></div></div>
    <dl>
      <dt>Origem</dt><dd><button className="detail-link" onClick={() => onTable(relation.source)}>
        {relation.source.schema}.{relation.source.name}<ArrowDownRight size={14} /></button></dd>
      <dt>Destino</dt><dd><button className="detail-link" onClick={() => onTable(relation.target)}>
        {relation.target.schema}.{relation.target.name}<ArrowDownRight size={14} /></button></dd>
      <dt>Colunas relacionadas</dt><dd className="column-pairs">{relation.columns.map((pair) => <div key={pair.ordinal}>
        <code>{database}.{relation.source.schema}.{relation.source.name}.{pair.source}</code>
        <ArrowDownRight size={13} />
        <code>{database}.{relation.target.schema}.{relation.target.name}.{pair.target}</code></div>)}</dd>
      <dt>Cardinalidade</dt><dd>
        <CardinalityDetail label={relation.source.name + ' por registro em ' + relation.target.name} value={relation.sourcePerTarget} />
        <CardinalityDetail label={relation.target.name + ' por registro em ' + relation.source.name} value={relation.targetPerSource} />
      </dd>
    </dl>
    {relation.unknownReason && <p className="details-note">{relation.unknownReason}</p>}
  </Details>
}

const tabs = [
  { id: 'dados', label: 'Dados', icon: Table2 },
  { id: 'estrutura', label: 'Estrutura', icon: Braces },
  { id: 'diagrama', label: 'Diagrama', icon: GitFork },
] as const

function TableWorkspace({ table, scope, onTable, refreshKey }: {
  table: Table; scope: TableScope; onTable: (table: Table) => void; refreshKey: number
}) {
  const controller = useTable(scope, refreshKey)
  const tabPrefix = useId()
  const metadata = controller.structure.status === 'ready' ? controller.structure.data : undefined
  const columns = metadata?.columns ?? (controller.records.status === 'ready' ? controller.records.data.columns : [])
  function switchTab(event: KeyboardEvent, id: Tab) {
    let index = tabs.findIndex((tab) => tab.id === id)
    if (event.key === 'ArrowRight') index = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') index = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') index = 0
    else if (event.key === 'End') index = tabs.length - 1
    else return
    event.preventDefault()
    const next = tabs[index].id
    controller.changeTab(next)
    document.getElementById(`${tabPrefix}-${next}`)?.focus()
  }
  return <>
    <main className="workspace">
      <div className="object-heading">
        <div className="breadcrumbs"><DatabaseIcon size={14} /><span>{scope.database}</span>
          <ChevronRight size={13} /><span>{table.schema}</span></div>
        <h1><Table2 size={25} />{table.name}</h1>
      </div>
      <div className="tabs" role="tablist" aria-label="Visão da tabela">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} id={`${tabPrefix}-${id}`} role="tab"
          aria-selected={controller.tab === id} aria-controls={`${tabPrefix}-panel`}
          tabIndex={controller.tab === id ? 0 : -1} onKeyDown={(event) => switchTab(event, id)}
          onClick={() => controller.changeTab(id)}><Icon size={15} />{label}</button>)}
      </div>
      <div className="tab-body" role="tabpanel" id={`${tabPrefix}-panel`} aria-labelledby={`${tabPrefix}-${controller.tab}`}>
        {controller.tab === 'dados' && <Records result={controller.records} columns={columns}
          request={controller.page} onChange={controller.setPage} retry={controller.refresh} scope={scope} />}
        {controller.tab === 'estrutura' && <Structure result={controller.structure} relationships={controller.relationships} retry={controller.refresh} />}
        {controller.tab === 'diagrama' && <Diagram result={controller.relationships} table={table}
          selected={controller.relationship} onSelect={controller.setRelationship} onTable={onTable} retry={controller.refresh} />}
      </div>
    </main>
    <ObjectDetails table={table} database={scope.database} metadata={metadata}
      relation={controller.tab === 'diagrama' ? controller.relationship : null} onTable={onTable} />
  </>
}

function DatabaseList({ connection, choose }: { connection: Connection; choose: (db: Database) => void }) {
  const [search, setSearch] = useState('')
  const matches = connection.databases.filter((db) => db.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  return <main className="workspace database-list">
    <div className="object-heading"><h1><DatabaseIcon size={25} />Bancos de dados</h1></div>
    <div className="database-catalog">
      <label className="search-field"><Search size={16} /><input placeholder="Buscar banco…" aria-label="Buscar na lista de bancos"
        value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      {matches.length ? <div className="database-cards">{matches.map((db) => <button key={db} onClick={() => choose(db)}>
        <span className="quiet-icon"><DatabaseIcon size={18} /></span><strong title={db}>{db}</strong><ArrowRight size={16} />
      </button>)}</div> : <Empty type="database" title={search ? 'Nenhum banco encontrado' : 'Nenhum banco acessível'}
        note={search ? undefined : 'Confira as permissões do login utilizado.'} />}
    </div>
  </main>
}

function DatabaseWorkspace({ scope, connection, onTable }: { scope: Scope; connection: Connection; onTable: (table: Table) => void }) {
  const [selected, setSelected] = useState<Relationship | null>(null)
  const [refresh, setRefresh] = useState(0)
  const { database, session } = scope
  const load = useCallback(() => sql.databaseDiagram({ database, session }), [database, session, refresh])
  const result = useRemote(load)
  return <>
    <main className="workspace">
      <div className="object-heading"><h1><DatabaseIcon size={24} />{database}</h1></div>
      {result.status === 'error' && <Failure error={result.error} retry={() => { setSelected(null); setRefresh(refresh + 1) }} />}
      {(result.status === 'idle' || result.status === 'loading') && <Loading />}
      {result.status === 'ready' && (result.data.tables.length
        ? <Graph tables={result.data.tables} relations={result.data.relationships} selected={selected} onSelect={setSelected} onTable={onTable} />
        : <Empty title="Nenhuma tabela visível" note="O catálogo do banco não retornou tabelas para este login." />)}
    </main>
    {selected ? <ObjectDetails table={selected.source} database={database} relation={selected} onTable={onTable} />
      : <ConnectionDetails connection={connection} database={database} />}
  </>
}

function ConnectedStudio({ connection, disconnect, openDiagrams, onScreen }: {
  connection: Connection; disconnect: () => Promise<void>; openDiagrams: () => void; onScreen: (screen: string) => void
}) {
  const [disconnecting, setDisconnecting] = useState(false)
  async function closeConnection() {
    if (disconnecting) return
    setDisconnecting(true)
    try { await disconnect() } finally { setDisconnecting(false) }
  }
  const [database, setDatabase] = useState<Database | null>(null)
  const [table, setTable] = useState<Table | null>(null)
  const [workspaceView, setWorkspaceView] = useState<'objects' | 'sql' | 'dashboard'>('objects')
  useEffect(() => {
    const page = workspaceView === 'sql' ? 'Editor SQL' : workspaceView === 'dashboard' ? 'Dashboards' :
      table ? 'Explorador de tabela' : database ? 'Diagrama do banco' : 'Lista de bancos'
    onScreen(page + ' · ' + engines[connection.engine].name)
  }, [connection.engine, database, table, workspaceView, onScreen])
  const [refreshKey, setRefreshKey] = useState(0)
  const explorer = useExplorer(connection, database, table, (db) => {
    setDatabase(db)
    setTable(null)
    setWorkspaceView('objects')
  }, (db, entry) => { setDatabase(db); setTable(entry); setWorkspaceView('objects') })
  return <>
    <Header onDiagrams={openDiagrams} connection={connection} database={database} onDatabase={explorer.chooseDatabase} onDisconnect={closeConnection} disconnecting={disconnecting}
      tools={database && <>
        {connection.engine === 'sqlServer' && <button className="button" aria-pressed={workspaceView === 'dashboard'}
          onClick={() => setWorkspaceView(workspaceView === 'dashboard' ? 'objects' : 'dashboard')}>
          <ChartNoAxesCombined size={15} /> Dashboards</button>}
        <button className="button" aria-pressed={workspaceView === 'sql'}
          onClick={() => setWorkspaceView(workspaceView === 'sql' ? 'objects' : 'sql')}><Braces size={15} /> SQL</button>
        {(table || workspaceView !== 'objects') && <button className="button" onClick={() => { setTable(null); setWorkspaceView('objects') }}><GitFork size={15} /> Diagrama do banco</button>}
        {table && workspaceView === 'objects' && <button className="icon-button" title="Atualizar tabela" aria-label="Atualizar tabela"
          onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={16} /></button>}
      </>} />
    <StudioLayout items={explorer.items} connected>
      {database && workspaceView === 'dashboard' ? <><main className="workspace">
        <Suspense fallback={<Loading />}><DatabaseDashboard key={database} database={database} session={connection.session} /></Suspense>
        </main><ConnectionDetails connection={connection} database={database} /></>
        : database && workspaceView === 'sql' ? <><main className="workspace"><div className="object-heading"><h1>{database}</h1></div>
        <Suspense fallback={<Loading />}><SqlEditor key={database} engine={connection.engine} scope={{ session: connection.session, database }} /></Suspense></main>
        <ConnectionDetails connection={connection} database={database} /></>
        : database && table ? <TableWorkspace key={JSON.stringify([database, table.id])} table={table}
        scope={{ session: connection.session, database, tableId: table.id }} refreshKey={refreshKey}
        onTable={(entry) => explorer.chooseRelatedTable(database, entry)} /> : database
        ? <DatabaseWorkspace key={database} scope={{ session: connection.session, database }} connection={connection}
            onTable={(entry) => explorer.chooseRelatedTable(database, entry)} />
        : <><DatabaseList connection={connection} choose={explorer.chooseDatabase} /><ConnectionDetails connection={connection} /></>}
    </StudioLayout>
    <StatusBar engine={connection.engine} endpoint={connection.endpoint} database={database} passwordSaveFailed={connection.passwordSaveFailed} />
  </>
}

export function App() {
  const [connection, setConnection] = useState<Connection | null>(null)
  const [step, setStep] = useState<Engine | 'picker' | 'intro'>('intro')
  const [selectedEngine, setSelectedEngine] = useState<Engine | null>(null)
  const [loading, setLoading] = useState(false)

  const [diagrams, setDiagrams] = useState(false)
  const [openedDiagrams, setOpenedDiagrams] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [provider, setProvider] = useState(readProvider)
  const [databaseScreen, setDatabaseScreen] = useState('Bancos de dados')
  const [currentDiagram, setCurrentDiagram] = useState<SystemDiagram | null>(null)
  const [assistantDiagram, setAssistantDiagram] = useState<{ diagram: SystemDiagram; revisionOf: SystemDiagram | null } | null>(null)
  const screen = diagrams ? 'Fluxogramas de sistema' : connection ? databaseScreen :
    step === 'intro' ? 'Tela inicial' : step === 'picker' ? 'Seleção de banco' : 'Conexão · ' + engines[step].name
  const openPicker = () => setStep('picker')

  function openDiagrams() {
    setOpenedDiagrams(true)
    setDiagrams(true)
  }

  function applyAssistantDiagram(diagram: SystemDiagram, revisionOf: SystemDiagram | null) {
    if (currentDiagram && currentDiagram !== revisionOf && !window.confirm('Abrir o fluxograma do assistente e substituir o fluxo atual no editor?')) return false
    setAssistantDiagram({ diagram, revisionOf })
    openDiagrams()
    return true
  }

  function chooseEngine(engine: Engine) {
    setSelectedEngine(engine)
    setStep(engine)
  }

  function connected(active: Connection) {
    setConnection(active)
    setStep('intro')
  }

  async function disconnect() {
    try { await sql.disconnect() } finally {
      setConnection(null)
      setSelectedEngine(null)
    }
  }

  return <>
    <div className="app-screen" hidden={diagrams}>
      {connection ? (isNoSql(connection.engine) ?
        <NoSqlStudio key={connection.session} connection={connection} disconnect={disconnect} openDiagrams={openDiagrams} onScreen={setDatabaseScreen} /> :
        <ConnectedStudio key={connection.session} connection={connection} disconnect={disconnect} openDiagrams={openDiagrams} onScreen={setDatabaseScreen} />) : <>
    <Header onConnect={openPicker} connecting={loading} onDiagrams={openDiagrams} />
    <StudioLayout items={[]} connected={false}>
      <main className="workspace welcome">
        {step === 'intro' && <div className="welcome-content welcome-intro">
          <div className="welcome-mark" aria-hidden="true"><img src={jujuba} alt="" /></div>
          <div className="welcome-copy">
            <h1>Conecte a um banco de dados</h1>
            <p>Consulte dados e explore tabelas, coleções e chaves.</p>
            <button className="button primary" onClick={openPicker}><Plug size={16} /> Nova conexão <ArrowRight size={16} /></button>
          </div>
        </div>}
        {step === 'picker' && <CenterEnginePicker selected={selectedEngine} choose={chooseEngine} back={() => { setStep('intro'); setSelectedEngine(null) }} />}
        {step === 'sqlServer' && <ConnectionForm onClose={openPicker} onConnected={connected} loading={loading} setLoading={setLoading} />}
        {step !== 'intro' && step !== 'picker' && step !== 'sqlServer' && (isNoSql(step) ?
          <NoSqlConnectionForm key={step} engine={step} onClose={openPicker} onConnected={connected} loading={loading} setLoading={setLoading} /> :
          <OtherConnectionForm key={step} engine={step} onClose={openPicker} onConnected={connected} loading={loading} setLoading={setLoading} />)}
      </main>
      <SelectedEngine engine={selectedEngine} />
    </StudioLayout>
    <StatusBar />
    </>}
    </div>
    {openedDiagrams && <div className="app-screen" hidden={!diagrams}>
      <Suspense fallback={<Loading />}><SystemDiagramStudio exit={() => setDiagrams(false)} provider={provider}
        assistantDiagram={assistantDiagram} onDiagram={setCurrentDiagram} /></Suspense>
    </div>}
    <AssistantDock open={assistantOpen} setOpen={setAssistantOpen} provider={provider} setProvider={setProvider}
      screen={screen} diagram={diagrams ? currentDiagram : null} onDiagram={applyAssistantDiagram} />
  </>
}
