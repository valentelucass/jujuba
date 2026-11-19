import { useMemo, useState } from 'react'
import { ChevronRight, ScanSearch, Search } from 'lucide-react'
import { assessment, executable, type useHostAnalysis } from '../controllers/useHostAnalysis'
import type { HostProcessUsage, Pm2Host, Pm2Process } from '../models/pm2'

type Inspection = ReturnType<typeof useHostAnalysis>
interface AppGroup { key: string; name: string; source: string; rows: HostProcessUsage[]; measured: number; bytes: number }
const isMeasured = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const time = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' })
const pct = (n: number | null) => !isMeasured(n) ? '—' : n > 0 && n < 0.1 ? '< 0,1%' : percent.format(n) + '%'
const helpers = /^(msedgewebview2|chrome_crashpad_handler|crashpad_handler|qtwebengineprocess|cefsharp\.browsersubprocess)$/
const launchers = /^(explorer|services|svchost|wininit|winlogon|dwm|system|csrss|conhost|cmd|powershell|pwsh)$/
const runtimes = /^(node|pythonw?|javaw?|dotnet|ruby|php)$/

function groupProcesses(rows: HostProcessUsage[], managed: Map<number, Pm2Process>) {
  const byPid = new Map(rows.map(row => [row.pid, row]))
  const groups = new Map<string, AppGroup>()
  for (const row of rows) {
    let owner = row, cursor: HostProcessUsage | undefined = row
    const seen = new Set<number>()
    const base = executable(row.name)
    let service: Pm2Process | undefined
    while (cursor && !seen.has(cursor.pid)) {
      seen.add(cursor.pid)
      service = managed.get(cursor.pid)
      if (service) break
      const parent: HostProcessUsage | undefined = cursor.parentPid != null ? byPid.get(cursor.parentPid) : undefined
      if (parent && cursor === owner) {
        const parentName = executable(parent.name)
        if ((runtimes.test(base) && parentName === base) || (helpers.test(executable(owner.name)) && !launchers.test(parentName))) owner = parent
      }
      cursor = parent
    }
    const exe = executable(owner.name)
    const key = service ? JSON.stringify(['pm2', service.namespace, service.id, service.name]) : runtimes.test(exe) || helpers.test(exe) ? exe + ':' + owner.pid : 'app:' + exe
    const g: AppGroup = groups.get(key) ?? { key, name: service?.name ?? owner.name, source: service ? 'PM2 #' + service.id + ' · ' + service.namespace : '', rows: [], measured: 0, bytes: 0 }
    g.rows.push(row)
    if (isMeasured(row.value)) { g.measured++; g.bytes += row.value }
    groups.set(key, g)
  }
  for (const g of groups.values()) g.rows.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.pid - b.pid)
  return [...groups.values()].sort((a, b) => Number(b.measured > 0) - Number(a.measured > 0) || b.bytes - a.bytes || a.name.localeCompare(b.name, 'pt-BR'))
}

export function Pm2MemoryInventory({ host, managed, format, inspection, evaluated }: {
  host: Pm2Host; managed: Map<number, Pm2Process>; format: (v: number) => string; inspection: Inspection; evaluated: Parameters<typeof assessment>[1]
}) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const rank = host.consumers?.memory
  const groups = useMemo(() => groupProcesses(rank?.rows ?? [], managed), [rank, managed])
  const measured = groups.reduce((sum, g) => sum + g.measured, 0)
  const privateBytes = measured ? groups.reduce((sum, g) => sum + g.bytes, 0) : null
  const used = host.memoryUsedBytes, total = host.memoryTotalBytes, win = host.windowsMemory
  const remaining = privateBytes !== null && isMeasured(used) && privateBytes <= used ? used - privateBytes : null
  const available = isMeasured(used) && isMeasured(total) && used <= total ? total - used : null
  const size = (v: number | null | undefined) => isMeasured(v) ? format(v) : 'Indisponível'
  const query = search.trim().toLocaleLowerCase('pt-BR')
  const filtered = groups.map(g => {
    const all = !query || (g.name + ' ' + g.source).toLocaleLowerCase('pt-BR').includes(query)
    const matches = all ? g.rows : g.rows.filter(r => (r.name + ' ' + r.pid).toLocaleLowerCase('pt-BR').includes(query))
    return { g, matches }
  }).filter(({ matches }) => matches.length > 0)
  const verdict = (row: HostProcessUsage) => assessment(row, evaluated)
  const [collapsedMatches, setCollapsedMatches] = useState<Set<string>>(() => new Set())
  function toggle(key: string) {
    if (query) {
      setCollapsedMatches(old => { const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next })
      return
    }
    setExpanded(old => { const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }
  return <div className="pm2-inventory">
    <dl className="pm2-ram-totals"><div><dt>Privada medida nos processos</dt><dd>{size(privateBytes)}</dd></div>
      <div><dt>Em uso fora dessa medição</dt><dd>{size(remaining)}</dd></div><div><dt>Disponível</dt><dd>{size(available)}</dd></div></dl>
    <details className="pm2-windows-memory"><summary>Memória do Windows</summary>
      <p>A RAM em uso fora da medição privada pode incluir o próprio Windows, memória compartilhada e processos sem leitura. Os indicadores abaixo podem se sobrepor. A reserva standby já faz parte da RAM disponível.</p>
      <dl><div><dt>Pool não paginável do kernel</dt><dd>{size(win?.kernelNonpagedBytes)}</dd></div>
        <div><dt>Pool paginável residente</dt><dd>{size(win?.pagedPoolResidentBytes)}</dd></div>
        <div><dt>Cache de sistema residente</dt><dd>{size(win?.systemCacheResidentBytes)}</dd></div>
        <div><dt>Reserva standby reaproveitável</dt><dd>{size(win?.standbyBytes)}</dd></div></dl>
    </details>
    <div className="pm2-inventory-tools"><label className="search-field"><Search size={14}/><input aria-label="Buscar aplicativo ou PID" placeholder="Buscar aplicativo ou PID" value={search} onChange={e => { setSearch(e.target.value); setCollapsedMatches(new Set()) }}/></label>
      <button className="button" type="button" disabled={inspection.loading} onClick={() => void inspection.analyze()}
        title="Consultar os critérios de otimização sem executar ações"><ScanSearch size={14}/>{inspection.loading ? 'Analisando…' : 'Analisar processos'}</button></div>
    {inspection.error && <p role="alert">Proteção indeterminada. {inspection.error}</p>}
    {inspection.data && <p className="pm2-inventory-note">Parecer das {time.format(inspection.data.sampledAt)} · {inspection.data.scannedCount} processos examinados.</p>}
    {(!rank || rank.status !== 'ready') && !groups.length ? <p>{rank?.status === 'warming' ? 'Aguardando a próxima amostra de memória.' : 'Inventário de processos indisponível nesta amostra.'}</p>
      : !filtered.length ? <p>{query ? 'Nenhum aplicativo ou PID corresponde à busca.' : 'Nenhum processo listado nesta amostra.'}</p> : <>
        <p className="pm2-inventory-note">{filtered.length} {filtered.length === 1 ? 'grupo' : 'grupos'} · {filtered.reduce((n, item) => n + item.matches.length, 0)} PIDs · percentual da RAM física total</p>
        <ul className="pm2-memory-groups">{filtered.map(({g, matches}) => {
          const open = query ? !collapsedMatches.has(g.key) : expanded.has(g.key)
          const opinions = inspection.data && new Set(g.rows.map(r => verdict(r).label))
          const opinion = opinions && (opinions.size === 1 ? opinions.values().next().value : 'Parecer por PID')
          return <li key={g.key}><button type="button" className="pm2-memory-group" aria-expanded={open} aria-label={'Processos de ' + g.name + (g.source ? ' · ' + g.source : '')}
            onClick={() => toggle(g.key)}><ChevronRight size={15}/><span><strong>{g.name}</strong><small>{g.source && g.source + ' · '}{g.rows.length} {g.rows.length === 1 ? 'PID' : 'PIDs'}{opinion && ' · ' + opinion}</small></span>
            <span>{size(g.measured ? g.bytes : null)}<small>{g.measured && total && total > 0 ? pct(100 * g.bytes / total) : '—'}{g.measured > 0 && g.measured < g.rows.length && ' · parcial'}</small></span></button>
            {open && <ul className="pm2-memory-pids">{matches.map(r => {
              const opinion = inspection.data && verdict(r)
              return <li key={r.pid}><div><strong>{r.name}</strong><small>PID {r.pid}</small>
                {opinion && <small>{opinion.label} · {opinion.detail}</small>}</div><div>{size(r.value)}<small>{pct(r.percent)}</small></div></li>
            })}</ul>}
          </li>
        })}</ul></>}
  </div>
}
