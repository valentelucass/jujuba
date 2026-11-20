import { useContext, useMemo, useState } from 'react'
import { ChartNoAxesCombined, CircleAlert, Clock3, Gauge, MemoryStick, Pause, Play, RefreshCw, Search, Server, Table2, TrendingUp, Users } from 'lucide-react'
import { useDatabaseMonitor } from '../controllers/useDatabaseMonitor'
import { engines } from '../models/engines'
import type { Connection } from '../models/sql'
import type { MetricUnit } from '../models/databaseMonitor'
import { StudioNavigation } from './Header'
import { exactSize, clock, DatabaseMemoryChart, stamp } from './DatabaseMemoryChart'
import { Failure, Loading } from './States'
import './databaseMonitor.css'

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const exactTime = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const periods = [{ label: 'Ao vivo', ms: 0 }, { label: '1 hora', ms: 3600000 }, { label: '24 horas', ms: 86400000 }, { label: '7 dias', ms: 604800000 }]
function metric(value: number, unit: MetricUnit) {
  if (!Number.isFinite(value)) return '—'
  if (unit === 'bytes') return exactSize(value)
  if (unit === 'milliseconds') return number.format(value) + ' ms'
  return number.format(value) + (unit === 'percent' ? '%' : unit === 'seconds' ? ' s' : '')
}
function flag(value: boolean | null | undefined) {
  return value == null ? 'indisponível' : value ? 'sim' : 'não'
}
function elapsed(ms: number | null) {
  if (ms === null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return number.format(ms) + ' ms'
  if (ms < 60000) return number.format(ms / 1000) + ' s'
  return number.format(ms / 60000) + ' min'
}

export default function DatabaseMonitor({ database, connection, onQueryHistory }: {
  database: string; connection: Connection; onQueryHistory?: () => void
}) {
  const navigation = useContext(StudioNavigation)
  const { reading, error, busy, paused, setPaused, refresh } = useDatabaseMonitor(connection, database, !navigation || navigation.area === 'database')
  const [period, setPeriod] = useState(0)
  const [search, setSearch] = useState('')
  const [instanceSessions, setInstanceSessions] = useState(true)
  const [sessionLimit, setSessionLimit] = useState(50)
  const points = useMemo(() => {
    if (!reading) return []
    return !period ? reading.live.map(p => ({ time: p.time, average: p.bytes })) :
      reading.history.filter(p => p.firstAt >= reading.time - period).map(p => ({ time: p.time, average: p.averageBytes, peak: p.peakBytes }))
  }, [reading, period])
  const data = reading?.sample
  const memory = data?.memory
  const history = reading?.history ?? []
  const peakBucket = history.reduce<typeof history[number] | undefined>(
    (best, bucket) => !best || bucket.peakBytes >= best.peakBytes ? bucket : best, undefined)
  const peak = peakBucket?.peakBytes
  const observedFrom = history[0]?.firstAt
  const observedTo = history.at(-1)?.lastAt
  const gapIndex = history.reduce((latest, bucket, index) =>
    index > 0 && bucket.firstAt - history[index - 1].lastAt > 60_000 ? index : latest, -1)
  const count = history.reduce((sum, bucket) => sum + bucket.samples, 0)
  const sqlServer = data?.sqlServer
  const rows = sqlServer && instanceSessions ? sqlServer.instanceRows : data?.activity ?? []
  const sessionCount = instanceSessions ? sqlServer?.instanceCount : sqlServer?.databaseCount
  const needle = search.trim().toLocaleLowerCase('pt-BR')
  const activity = rows.filter(row => !needle || [row.id, row.database, row.application, row.client, row.operation, row.state, row.object]
    .some(value => value?.toLocaleLowerCase('pt-BR').includes(needle)))
  const status = error ? 'Falha na leitura' : paused ? 'Pausado' : reading ? 'Ao vivo' : 'Conectando'
  return <main className="dbm" aria-label="Monitor do banco">
    <div className="dbm-toolbar"><span className="dbm-symbol"><Gauge size={24}/></span>
      <div><h1>Monitor do banco</h1><p><span>{engines[connection.engine].name}</span><span aria-hidden="true"> / </span><strong>{database}</strong></p></div>
      <div className="dbm-actions"><span className={'dbm-live' + (error || paused || !reading ? ' inactive' : '')}><i/>{status}
        {reading && <time title={'Última leitura ' + stamp.format(reading.time)}>{clock.format(reading.time)}</time>}</span>
        <button className="button" onClick={() => setPaused(!paused)}>{paused ? <Play size={14}/> : <Pause size={14}/>}
          {paused ? 'Retomar' : 'Pausar'}</button>
        <button className="button" disabled={busy} onClick={refresh}><RefreshCw size={14} className={busy ? 'spin' : ''}/>Atualizar</button>
      </div>
    </div>
    {error && <Failure error={error} title={reading ? 'A última atualização falhou' : 'Não foi possível abrir o monitor'} retry={busy ? undefined : refresh}/>}
    {!reading && !error && <Loading/>}
    {reading && data && memory && <>
      <div className="dbm-cards" aria-label="Resumo de memória">
        <div className="dbm-card"><h2><MemoryStick/>Memória em uso</h2><strong>{exactSize(memory.usedBytes)}</strong>
          {memory.usedBytes != null && <small>{number.format(memory.usedBytes)} bytes</small>}<p>{memory.label} · {memory.scope}</p></div>
        <div className="dbm-card"><h2><Server/>Limite configurado</h2><strong>{exactSize(memory.limitBytes)}</strong>
          {memory.limitBytes != null && <small>{number.format(memory.limitBytes)} bytes</small>}<p>{memory.limitLabel || 'Limite indisponível para esta medição'}</p></div>
        <div className="dbm-card"><h2><TrendingUp/>Maior leitura observada · até 7 dias</h2><strong>{exactSize(peak)}</strong>
          {peakBucket && <small>{number.format(peakBucket.peakBytes)} bytes · {peakBucket.peakAt != null
            ? exactTime.format(peakBucket.peakAt)
            : 'intervalo de ' + clock.format(peakBucket.firstAt) + ' a ' + clock.format(peakBucket.lastAt) + ' em ' + new Date(peakBucket.firstAt).toLocaleDateString('pt-BR')}</small>}
          <p>{observedFrom != null && observedTo != null ?
          count === 1 ? 'Uma medição em ' + stamp.format(observedTo) : stamp.format(observedFrom) + ' a ' + stamp.format(observedTo) + ' · ' + number.format(count) + ' amostras'
          : 'Aguardando uma medição de consumo'}</p></div>
        {memory.nativePeakBytes !== null && <div className="dbm-card"><h2><Clock3/>Pico do servidor</h2><strong>{exactSize(memory.nativePeakBytes)}</strong><p>{memory.nativePeakLabel}</p></div>}
        {sqlServer && <div className="dbm-card"><h2><Gauge/>Pressão de memória agora</h2>
          <strong>{sqlServer.hostMemoryLow || sqlServer.processMemoryLow ? 'Memória física baixa'
            : (sqlServer.waitingForMemory ?? 0) > 0 ? 'Consultas na fila'
            : sqlServer.hostMemoryLow === false && sqlServer.processMemoryLow === false && sqlServer.waitingForMemory === 0
              ? 'Sem sinal de pressão' : 'Leitura parcial'}</strong>
          <p>Consultas na fila: {sqlServer.waitingForMemory ?? '—'} · Alerta de RAM do Windows: {flag(sqlServer.hostMemoryLow)} · Alerta do processo SQL: {flag(sqlServer.processMemoryLow)}</p>
        </div>}
      </div>
      <div className="dbm-grid">
        <section className="dbm-panel"><div className="dbm-panel-head"><h2><ChartNoAxesCombined/>Histórico de memória</h2>
          <div className="dbm-period" role="group" aria-label="Período do gráfico">{periods.map(p =>
            <button type="button" key={p.ms} aria-pressed={period === p.ms} onClick={() => setPeriod(p.ms)}>{p.label}</button>)}</div></div>
          <div className="dbm-chart-body"><p>{memory.label} · {period ? 'intervalos de 5 min' : 'últimos 10 min'}</p>
            <DatabaseMemoryChart points={points} live={!period}/>
            <div className="dbm-chart-footer">{period > 0 && <div className="dbm-legend"><span>Média</span><span>Pico</span></div>}
              <span>{period ? 'Intervalos sem coleta ficam em branco.' : points.length === 1 ? 'Uma leitura nesta janela. Aguardando a próxima amostra.' : points.length + ' leituras nesta janela.'} Histórico coletado com o monitor visível.</span>
              {gapIndex > 0 && <span>Intervalo sem amostras de {exactTime.format(history[gapIndex - 1].lastAt)} a {exactTime.format(history[gapIndex].firstAt)}.</span>}</div>
          </div></section>
        <section className="dbm-panel"><div className="dbm-panel-head"><h2><Gauge/>Indicadores do motor</h2></div>
          {data.indicators.length ? <dl className="dbm-indicators">{data.indicators.map((i, index) =>
            <div key={index}><dt>{i.label}<small>{i.scope}</small></dt><dd>{metric(i.value, i.unit)}</dd></div>)}</dl> :
            <p className="dbm-empty">O motor não retornou indicadores adicionais nesta leitura.</p>}</section>
      </div>
      <section className="dbm-panel"><div className="dbm-panel-head"><h2><Users/>Sessões e aplicações</h2>
        {sqlServer && <div className="dbm-period" role="group" aria-label="Escopo das sessões">
          <button type="button" aria-pressed={!instanceSessions} onClick={() => setInstanceSessions(false)}>Banco selecionado{sqlServer.databaseCount != null && ' (' + number.format(sqlServer.databaseCount) + ')'}</button>
          <button type="button" aria-pressed={instanceSessions} onClick={() => setInstanceSessions(true)}>Instância{sqlServer.instanceCount != null && ' (' + number.format(sqlServer.instanceCount) + ')'}</button>
        </div>}
        <label className="search-field"><Search size={14}/><input aria-label="Filtrar sessões e aplicações" placeholder="Filtrar por aplicação, sessão ou objeto" value={search} onChange={e => setSearch(e.target.value)}/></label></div>
        {sqlServer && <p className="dbm-context">{sessionCount == null ? 'Leitura de sessões indisponível.' : (sqlServer.fullVisibility ? 'Sessões de usuário' : 'Visibilidade limitada às sessões autorizadas') + ' · ' + number.format(sessionCount) + ' visíveis neste escopo.'}
          {' '}A conexão desta leitura é excluída. Requisições em andamento aparecem primeiro.</p>}
        {activity.length ? <div className="dbm-table-wrap"><table><thead><tr><th>Sessão</th>{sqlServer && <th>Banco</th>}<th>Aplicação / cliente</th><th>Operação</th><th>Estado</th><th>Objeto identificado</th><th>Duração</th>{sqlServer && <th>Última requisição concluída (hora do servidor)</th>}</tr></thead>
          <tbody>{(sqlServer ? activity.slice(0, sessionLimit) : activity).map((r, index) => <tr key={r.id + ':' + index}><td>{r.id}</td>{sqlServer && <td>{r.database || 'Indisponível'}</td>}<td><strong>{r.application || r.client || 'Não informado'}</strong>
            {r.client && r.application && <small>{r.client}</small>}</td><td>{r.operation || '—'}</td><td>{r.state || '—'}</td><td>{r.object || '—'}</td><td>{elapsed(r.elapsedMs)}</td>{sqlServer && <td>{r.lastRequestEnd || '—'}</td>}</tr>)}</tbody></table></div>
          : (!sqlServer || sessionCount != null) && <p className="dbm-empty">{needle ? 'Nenhuma sessão corresponde ao filtro.' : sqlServer
            ? instanceSessions ? 'Nenhuma outra sessão de usuário visível na instância nesta amostra.' : 'Nenhuma outra sessão de usuário visível neste banco nesta amostra.'
            : 'Nenhuma sessão retornada nesta leitura.'}</p>}
        {sqlServer && activity.length > sessionLimit && <button className="button" type="button" onClick={() => setSessionLimit(n => n + 50)}>
          Mostrar mais sessões ({sessionLimit} de {activity.length})</button>}
      </section>
      <section className="dbm-panel"><div className="dbm-panel-head"><h2><Table2/>{sqlServer ? 'Acessos a índices por tabela' : 'Atividade por objeto'}</h2>
        {sqlServer && onQueryHistory && <button className="button" type="button" onClick={onQueryHistory}><Clock3 size={14}/>Histórico de consultas</button>}
      </div>
        {sqlServer && <p className="dbm-context">{database} · Até 20 tabelas por acesso mais recente. Contadores de operações acumulados desde a reinicialização das estatísticas de cada índice.</p>}
        {sqlServer && data.objects.length > 0 ? <div className="dbm-table-wrap"><table><thead><tr><th>Tabela</th><th>Leituras de índice</th><th>Atualizações de índice</th><th>Último acesso (hora do servidor)</th></tr></thead>
          <tbody>{data.objects.map(o => <tr key={o.name}><td>{o.name}</td><td>{o.usage && number.format(o.usage.reads)}</td>
            <td>{o.usage && number.format(o.usage.updates)}</td><td>{o.usage?.lastAccess ?? '—'}</td></tr>)}</tbody></table></div>
        : data.objects.length ? <div className="dbm-table-wrap"><table><thead><tr><th>Objeto</th><th>Indicador</th><th>Valor</th><th>Período / escopo</th></tr></thead>
          <tbody>{data.objects.map((o, index) => <tr key={index}><td><strong>{o.name}</strong></td><td>{o.metric}</td><td>{metric(o.value, o.unit)}</td><td>{o.window}</td></tr>)}</tbody></table></div>
          : <p className="dbm-empty">{sqlServer ? sqlServer.objectsAvailable
            ? 'Nenhum acesso de usuário registrado nos índices das tabelas visíveis deste banco.'
            : 'Estatísticas de uso de índices indisponíveis para esta conexão.'
            : 'Nenhum objeto com atividade identificada nesta leitura.'}</p>}</section>
      {data.notes.length > 0 && <aside className="dbm-notes"><h2><CircleAlert size={16}/>Sobre esta leitura</h2>
        <ul>{data.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></aside>}
    </>}
  </main>
}
