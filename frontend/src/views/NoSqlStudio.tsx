import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react'
import { Braces, ChevronLeft, ChevronRight, Database, KeyRound, PanelRight, RefreshCw, Search } from 'lucide-react'
import { noSql } from '../controllers/api'
import { activeDatabase, rememberActiveDatabase } from '../controllers/connectionPreference'
import type { TreeItem } from '../controllers/useExplorer'
import { useRemote } from '../controllers/useRemote'
import { engines } from '../models/engines'
import type { RedisKey } from '../models/noSql'
import type { Connection, Scope } from '../models/sql'
import { DatabaseTools, Header, HeaderAction } from './Header'
import { Empty, Failure, Loading } from './States'
import { StatusBar } from './StatusBar'
import { StudioLayout } from './StudioLayout'

const DatabaseDashboard = lazy(() => import('./DatabaseDashboard'))
const DatabaseMonitor = lazy(() => import('./DatabaseMonitor'))

export function NoSqlStudio({ connection, disconnect, onScreen }: {
  connection: Connection; disconnect: () => Promise<void>; onScreen: (screen: string) => void
}) {
  const mongo = connection.engine === 'mongodb'
  const engine = engines[connection.engine]
  const [database, setDatabase] = useState<string | null>(() =>
    activeDatabase(connection.engine, connection.databases) ??
    connection.databases.find((name) => !['admin', 'config', 'local'].includes(name)) ?? connection.databases[0] ?? null)
  const [collection, setCollection] = useState<string | null>(null)
  const [view, setView] = useState<'explorer' | 'dashboard' | 'monitor'>('explorer')
  useEffect(() => {
    onScreen(view === 'monitor' ? 'Monitor do banco · ' + engine.name : view === 'dashboard' ? 'Dashboards · ' + engine.name : connection.engine === 'redis' ? 'Explorador de chaves · Redis' :
      collection ? 'Documentos · MongoDB' : 'Coleções · MongoDB')
  }, [connection.engine, collection, view, engine.name, onScreen])
  const [disconnecting, setDisconnecting] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const session = connection.session
  const load = useCallback(() => noSql.collections({ session, database: database! }), [session, database, refresh])
  const collections = useRemote(mongo && database ? load : null)
  const names = collections.status === 'ready' ? collections.data : []
  const scope = database ? { session, database } : null
  const showingMonitor = view === 'monitor' && database !== null

  function selectDatabase(name: string) {
    setDatabase(name)
    setCollection(null)
    rememberActiveDatabase(connection.engine, name)
  }

  function selectCollection(name: string) {
    setCollection(name)
    setView('explorer')
  }

  async function close() {
    if (disconnecting) return
    setDisconnecting(true)
    try { await disconnect() } finally { setDisconnecting(false) }
  }

  const items: TreeItem[] = connection.databases.flatMap((name) => {
    const id = 'db:' + name
    const active = name === database
    const node: TreeItem = {
      id, label: name, type: 'database', level: 1,
      ...(mongo ? { expanded: active, toggle: () => active ? setDatabase(null) : selectDatabase(name) } : {}),
      selected: active && !collection, choose: () => selectDatabase(name),
    }
    if (!active || !mongo) return [node]
    return [node, ...names.map((name): TreeItem => ({
      id: id + '/collection:' + name, parent: id, label: name, type: 'table', level: 2,
      selected: collection === name, choose: () => selectCollection(name),
    }))]
  })

  return <>
    <Header connection={connection} database={database} onDisconnect={close}
      disconnecting={disconnecting} onDatabase={selectDatabase} tools={<>
        <DatabaseTools active={view === 'explorer' ? undefined : view}
          actions={scope ? { dashboard: () => setView('dashboard'), monitor: () => setView('monitor') } : undefined} />
        <HeaderAction label={mongo ? 'Coleções' : 'Chaves'} hint={mongo ? 'Explore as coleções do banco.' : 'Explore as chaves do banco.'}
          unavailable={!scope} active={view === 'explorer'} onClick={() => setView('explorer')}>{mongo ? <Braces /> : <KeyRound />}</HeaderAction>
      </>} />
    <StudioLayout items={items} connected>
      {showingMonitor ?
        <Suspense fallback={<Loading />}><DatabaseMonitor key={database} connection={connection} database={database} /></Suspense>
        : scope && view === 'dashboard' ? <main className="workspace">
        <Suspense fallback={<Loading />}><DatabaseDashboard key={database} {...scope} engine={connection.engine} /></Suspense>
      </main> : <main className="workspace nosql-workspace">
        <div className="object-heading">
          {database && collection && <div className="breadcrumbs"><Database size={14} />{database}<ChevronRight size={13} />Coleções</div>}
          <h1>{mongo ? <Braces size={23} /> : <KeyRound size={23} />}{collection ?? database ?? engine.name}</h1>
        </div>
        {!scope ? <Empty title={connection.databases.length ? 'Selecione um banco' : 'Nenhum banco acessível'} /> :
          mongo ? <>
            {collections.status === 'loading' && <Loading />}
            {collections.status === 'error' && <Failure error={collections.error} retry={() => setRefresh((value) => value + 1)} />}
            {collections.status === 'ready' && (collection !== null
              ? <MongoDocuments key={JSON.stringify([database, collection])} scope={scope} collection={collection} />
              : names.length
                ? <div className="nosql-collections"><h2>Coleções</h2><div className="database-cards">
                  {names.map((name) => <button key={name} onClick={() => selectCollection(name)}>
                    <span className="quiet-icon"><Braces size={17} /></span><strong title={name}>{name}</strong><ChevronRight size={15} />
                  </button>)}
                </div></div>
                : <Empty title="Nenhuma coleção acessível" />)}
          </> : <RedisBrowser key={database} scope={scope} />}
      </main>}
      {!showingMonitor && <aside className="details">
        <div className="panel-title"><PanelRight size={15} /><h2>Detalhes</h2></div>
        <div className="details-body">
          <div className="details-heading"><span className="engine-icon"><img src={engine.icon} alt="" /></span>
            <div><h3>Conexão {engine.name}</h3><p>Sessão ativa</p></div></div>
          <dl><dt>Servidor</dt><dd>{connection.endpoint}</dd>
            {database && <><dt>Banco</dt><dd>{database}</dd></>}
            {collection && <><dt>Coleção</dt><dd>{collection}</dd></>}
            <dt>Modo</dt><dd>Consulta</dd>
          </dl>
        </div>
      </aside>}
    </StudioLayout>
    <StatusBar engine={connection.engine} endpoint={connection.endpoint} database={database} passwordSaveFailed={connection.passwordSaveFailed} />
  </>
}

function MongoDocuments({ scope, collection }: { scope: Scope; collection: string }) {
  const [draft, setDraft] = useState('')
  const [request, setRequest] = useState({ filter: '', page: 0 })
  const { session, database } = scope
  const load = useCallback(() => noSql.documents({ session, database }, collection, request.filter, request.page),
    [session, database, collection, request])
  const result = useRemote(load)
  const data = result.status === 'ready' ? result.data : undefined

  function apply(event: FormEvent) {
    event.preventDefault()
    setRequest({ filter: draft, page: 0 })
  }

  return <div className="nosql-layout">
    <form className="nosql-toolbar" onSubmit={apply}>
      <label>Filtro JSON<input className="nosql-code-input" value={draft} maxLength={32768}
        placeholder='{"status":"ativo"}' spellCheck={false} onChange={(event) => setDraft(event.target.value)} /></label>
      <button className="button"><Search size={15} /> Filtrar</button>
    </form>
    <div className="nosql-results">
      {result.status === 'loading' && <Loading />}
      {result.status === 'error' && <Failure error={result.error} retry={() => setRequest({ ...request })} />}
      {data && !data.documents.length && <Empty title="Nenhum documento encontrado" />}
      {data?.documents.map((document, index) => <details className="nosql-document" key={index} open={index === 0}>
        <summary>{document.title}</summary>
        <pre>{document.json}</pre>
        {document.truncated && <p className="page-note">Conteúdo parcial.</p>}
      </details>)}
    </div>
    <div className="pagination"><span>{data ? data.documents.length + ' nesta página' : ''}</span>
      <div className="pagination-controls">
        <button className="icon-button" aria-label="Página anterior" disabled={!request.page || result.status === 'loading'}
          onClick={() => setRequest({ ...request, page: request.page - 1 })}><ChevronLeft size={16} /></button>
        <span>Página {request.page + 1}</span>
        <button className="icon-button" aria-label="Próxima página" disabled={!data?.hasNext}
          onClick={() => setRequest({ ...request, page: request.page + 1 })}><ChevronRight size={16} /></button>
      </div>
    </div>
  </div>
}

function RedisBrowser({ scope }: { scope: Scope }) {
  const { session, database } = scope
  const [draft, setDraft] = useState('')
  const [request, setRequest] = useState({ pattern: '', cursors: ['0'] })
  const [selected, setSelected] = useState<RedisKey | null>(null)
  const [refresh, setRefresh] = useState(0)
  const cursor = request.cursors.at(-1)!
  const keys = useRemote(useCallback(() => noSql.keys({ session, database }, cursor, request.pattern),
    [session, database, request, cursor]))
  const loadEntry = useCallback(() => noSql.entry({ session, database }, selected!.id), [session, database, selected, refresh])
  const entry = useRemote(selected ? loadEntry : null)
  const data = keys.status === 'ready' ? keys.data : undefined
  const value = entry.status === 'ready' ? entry.data : undefined

  function apply(event: FormEvent) {
    event.preventDefault()
    setSelected(null)
    setRequest({ pattern: draft, cursors: ['0'] })
  }

  function browse(cursors: string[]) {
    setSelected(null)
    setRequest({ ...request, cursors })
  }

  return <div className="nosql-layout">
    <form className="nosql-toolbar" onSubmit={apply}>
      <label>Padrão da chave<input className="nosql-code-input" placeholder="pedidos:*" value={draft}
        maxLength={512} spellCheck={false} onChange={(event) => setDraft(event.target.value)} /></label>
      <button className="button"><Search size={15} /> Buscar chaves</button>
    </form>
    <div className="redis-browser">
      <div className="nosql-results redis-keys">
        {keys.status === 'loading' && <Loading />}
        {keys.status === 'error' && <Failure error={keys.error} retry={() => setRequest({ ...request })} />}
        {data && (data.keys.length ? <ul>{data.keys.map((key) => <li key={key.id}>
          <button type="button" aria-pressed={key.id === selected?.id} title={key.name}
            onClick={() => setSelected(key)}><KeyRound size={14} /> {key.name}</button>
        </li>)}</ul> : <Empty title={data.next ? 'Nenhuma chave neste trecho' : 'Nenhuma chave encontrada'} />)}
      </div>
      <section className="nosql-results redis-value" aria-label="Valor da chave">
        {!selected && <Empty title="Selecione uma chave" />}
        {entry.status === 'loading' && <Loading />}
        {entry.status === 'error' && <Failure error={entry.error} retry={() => setRefresh((value) => value + 1)} />}
        {value && <><div className="redis-value-heading"><h2>{selected?.name}</h2>
          <button className="icon-button" aria-label="Atualizar valor" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={15} /></button>
        </div>
          {value.kind === 'none' ? <Empty title="A chave expirou ou foi removida" /> : <>
            <dl><dt>Tipo</dt><dd>{value.kind}</dd><dt>Expiração</dt><dd>{value.ttl < 0 ? 'Sem expiração' : value.ttl + ' s'}</dd></dl>
            {value.value === null ? <Empty title="Prévia indisponível para este tipo" /> :
              <pre>{typeof value.value === 'string' ? value.value : JSON.stringify(value.value, null, 2)}</pre>}
            {value.truncated && <p className="page-note">Conteúdo parcial.</p>}
          </>}
        </>}
      </section>
    </div>
    <div className="pagination"><span>{data ? data.keys.length + ' neste trecho' : ''}</span>
      <div className="pagination-controls">
        <button className="icon-button" aria-label="Trecho anterior" disabled={request.cursors.length <= 1 || keys.status === 'loading'}
          onClick={() => browse(request.cursors.slice(0, -1))}><ChevronLeft size={16} /></button>
        <span>Trecho {request.cursors.length}</span>
        <button className="icon-button" aria-label="Próximo trecho" disabled={!data?.next}
          onClick={() => { if (data?.next) browse([...request.cursors, data.next]) }}><ChevronRight size={16} /></button>
      </div>
    </div>
  </div>
}
