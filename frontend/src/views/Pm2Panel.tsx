import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, AlertCircle, ArrowDown, ArrowUp, Check, ChevronDown, CircuitBoard, Cpu, FilePlus2, HardDrive, Layers3, ListTree, LoaderCircle, MemoryStick, MoreHorizontal, Play, RefreshCw, RotateCcw, Save, ScrollText, Search, Square, Terminal, Trash2, X } from 'lucide-react'
import { init, use, type ECharts } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { appError } from '../controllers/api'
import { pm2, usePm2Monitor } from '../controllers/pm2'
import type { Pm2Action, Pm2Process, Pm2ShellView, Pm2Snapshot, Pm2StateAction } from '../models/pm2'
import { useTheme } from './Theme'
import './pm2.css'

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const clock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const statusNames: Record<string, string> = {
  online: 'Em execução', stopped: 'Parado', errored: 'Com erro', launching: 'Iniciando', stopping: 'Parando',
  'waiting restart': 'Aguardando reinício', 'one-launch-status': 'Execução única',
}
const actionLabels: Record<Pm2Action | 'scale', string> = { start: 'Iniciar', stop: 'Parar', restart: 'Reiniciar', reload: 'Recarregar', delete: 'Remover do PM2', scale: 'Ajustar instâncias' }
const actionIcons = { start: Play, stop: Square, restart: RotateCcw, reload: RefreshCw, delete: Trash2, scale: Layers3 }
const actionSuccess: Record<Pm2Action | 'scale', string> = { start: 'Inicialização solicitada', stop: 'Parada solicitada', restart: 'Reinício solicitado', reload: 'Recarga solicitada', delete: 'Processo removido do PM2', scale: 'Ajuste de instâncias solicitado' }
const shellLabels: Record<Pm2ShellView, string> = { shell: 'Abrir PowerShell no projeto', logs: 'Logs em tempo real', describe: 'Descrição completa', monit: 'Monitor global no terminal' }
const shellSuccess: Record<Pm2ShellView, string> = { shell: 'PowerShell aberto', logs: 'Logs abertos no PowerShell', describe: 'Descrição aberta no PowerShell', monit: 'Monitor global aberto no PowerShell' }
const shellIcons = { shell: Terminal, logs: ScrollText, describe: ListTree, monit: Activity }
const isShellView = (cmd: Command): cmd is Pm2ShellView => Object.hasOwn(shellLabels, cmd)
const stateLabels: Record<Pm2StateAction, string> = { save: 'Salvar lista', resurrect: 'Restaurar lista' }
const statusName = (status: string) => statusNames[status] ?? (status || 'Indisponível')
const processKey = (p: Pm2Process) => JSON.stringify([p.id, p.name, p.namespace])
const isCluster = (p: Pm2Process) => p.mode === 'cluster_mode' || p.mode === 'cluster'

function actions(p: Pm2Process): Pm2Action[] {
  if (p.status === 'stopped' || p.status === 'errored') return ['start', 'delete']
  if (p.status === 'waiting restart') return ['stop', 'delete']
  if (p.status !== 'online') return ['delete']
  return isCluster(p) ? ['restart', 'reload', 'stop', 'delete'] : ['restart', 'stop', 'delete']
}

function portsText(ports: number[] | null) {
  if (!ports) return 'Indisponível'
  return ports.length ? ports.join(', ') : 'Nenhuma'
}

function bytes(value: number) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  const index = value > 0 ? Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(value) / Math.log(1024)))) : 0
  return number.format(value / 1024 ** index) + ' ' + units[index]
}
const percent = (value: number) => number.format(value) + '%'
const rate = (value: number) => bytes(value) + '/s'
const count = (value: number) => number.format(value)
const valueText = (value: number | null, format: (v: number) => string) => value !== null && Number.isFinite(value) ? format(value) : '—'

function uptime(p: Pm2Process, sampledAt: number) {
  if (p.status !== 'online' || !p.startedAt || p.startedAt > sampledAt) return '—'
  const seconds = Math.floor((sampledAt - p.startedAt) / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) return Math.floor(hours / 24) + ' d ' + hours % 24 + ' h'
  if (hours) return hours + ' h ' + minutes % 60 + ' min'
  if (minutes) return minutes + ' min ' + seconds % 60 + ' s'
  return seconds + ' s'
}

interface Trace {
  label: string
  color: string
  values: (number | null)[]
}
function Trend({ history, traces, format, label, stepped = false, ceiling }: {
  history: Pm2Snapshot[]; traces: Trace[]; format: (value: number) => string; label: string; stepped?: boolean; ceiling?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<ECharts | null>(null)
  const { theme } = useTheme()
  const available = traces.some((trace) => trace.values.some((value) => value !== null && Number.isFinite(value)))
  useEffect(() => {
    if (!available || !ref.current) return
    const graph = init(ref.current)
    chart.current = graph
    const observer = new ResizeObserver(() => graph.resize())
    observer.observe(ref.current)
    return () => { observer.disconnect(); graph.dispose(); chart.current = null }
  }, [available])
  useEffect(() => {
    if (!chart.current || !ref.current) return
    const css = getComputedStyle(ref.current)
    const token = (name: string) => css.getPropertyValue(name).trim()
    const start = history[0].sampledAt
    const end = history[history.length - 1].sampledAt
    chart.current.setOption({
      animation: false,
      backgroundColor: 'transparent',
      grid: { top: 8, left: 4, right: 5, bottom: 2, containLabel: false },
      xAxis: { type: 'time', min: start === end ? start - 1500 : start, max: start === end ? end + 1500 : end, show: false },
      yAxis: { type: 'value', min: 0, max: ceiling, minInterval: stepped ? 1 : undefined, splitNumber: 2,
        axisLabel: { show: false }, splitLine: { lineStyle: { color: token('--line'), type: 'dashed', opacity: 0.65 } } },
      tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, valueFormatter: (v: unknown) => typeof v === 'number' ? format(v) : '—',
        backgroundColor: token('--raised'), borderColor: token('--line-strong'), textStyle: { color: token('--text') } },
      series: traces.map(({label: name, color, values}) => {
        const data: [number, number | '-'][] = []
        for (let i = 0; i < history.length; i++) {
          if (i && history[i].sampledAt - history[i - 1].sampledAt > 9000) data.push([history[i - 1].sampledAt + 1, '-'])
          const value = values[i]
          data.push([history[i].sampledAt, value !== null && Number.isFinite(value) ? value : '-'])
        }
        return { type: 'line', name, data, step: stepped ? 'end' : false, connectNulls: false, symbol: 'circle',
          showSymbol: true, symbolSize: history.length < 30 ? 4 : 2, lineStyle: { width: 2 }, itemStyle: { color: token(color) },
          areaStyle: traces.length === 1 ? { opacity: 0.08 } : undefined }
      }),
    }, true)
  }, [history, traces, format, theme, stepped, ceiling, available])
  if (!available) return <div className="pm2-no-trend">Sem amostras disponíveis</div>
  return <div className="pm2-plot" role="img" aria-label={label}>
    <div ref={ref} className="pm2-chart" /><div className="pm2-axis"><span>{clock.format(history[0].sampledAt)}</span>
      {history.length > 1 && <span>{clock.format(history[history.length - 1].sampledAt)}</span>}</div>
  </div>
}

function HostCards({ history }: { history: Pm2Snapshot[] }) {
  const host = history[history.length - 1].host
  const trace = (key: keyof Pm2Snapshot['host'], label: string, color: string): Trace => ({ label, color, values: history.map((s) => s.host[key]) })
  return <section className="pm2-host" aria-label="Recursos do computador">
    <article className="pm2-card"><h2><Cpu size={17} />CPU do computador</h2>
      <div className="pm2-value">{valueText(host.cpuPercent, percent)}</div>
      <Trend label="Histórico da CPU do computador" history={history} format={percent} ceiling={100}
        traces={[trace('cpuPercent', 'CPU', '--mint')]} /></article>
    <article className="pm2-card"><h2><MemoryStick size={17} />Memória do computador</h2>
      <div className="pm2-value">{valueText(host.memoryUsedBytes, bytes)}<small> de {valueText(host.memoryTotalBytes, bytes)}</small></div>
      <Trend label="Histórico da memória usada no computador" history={history} format={bytes} ceiling={host.memoryTotalBytes ?? undefined}
        traces={[trace('memoryUsedBytes', 'Memória usada', '--berry')]} /></article>
    <article className="pm2-card"><h2><HardDrive size={17} />Tráfego de disco</h2>
      <div className="pm2-io"><div><span><ArrowDown size={12} />Leitura</span><strong>{valueText(host.diskReadBytesPerSec, rate)}</strong></div>
        <div><span><ArrowUp size={12} />Gravação</span><strong>{valueText(host.diskWriteBytesPerSec, rate)}</strong></div></div>
      <Trend label="Histórico de leitura e gravação em disco" history={history} format={rate}
        traces={[trace('diskReadBytesPerSec', 'Leitura', '--mint'), trace('diskWriteBytesPerSec', 'Gravação', '--gold')]} />
    </article>
  </section>
}

function ProcessStatus({ status }: { status: string }) {
  return <span className="pm2-state" data-state={status}><i />{statusName(status)}</span>
}

type Command = Pm2Action | Pm2ShellView | 'scale'
type Selection = { process: Pm2Process; action: Pm2Action | 'scale' } | { action: Pm2StateAction }
function Confirmation({ selection, valid, clusterSize, cancel, confirm }: { selection: Selection; valid: boolean; clusterSize: number; cancel: () => void; confirm: (instances?: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [amount, setAmount] = useState(String(clusterSize || 1))
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close() }, [])
  const { action } = selection
  const p = 'process' in selection ? selection.process : null
  const description: Partial<Record<Selection['action'], string>> = {
    stop: 'O processo ficará parado até ser iniciado novamente.',
    restart: 'A execução atual será interrompida e o processo iniciará um novo ciclo.',
    reload: 'O PM2 solicitará a recarga desta instância do cluster.',
    delete: 'O PM2 vai parar esta instância e removê-la da lista de processos.',
    scale: 'O PM2 vai iniciar ou remover instâncias deste aplicativo para atingir o total escolhido.',
    save: 'A lista atual de todos os processos será gravada, substituindo a lista salva anteriormente.',
    resurrect: 'O PM2 vai restaurar os aplicativos da lista salva e poderá iniciar processos.',
  }
  const label = action === 'save' || action === 'resurrect' ? stateLabels[action] : actionLabels[action]
  const canConfirm = valid && (action !== 'scale' || (/^[1-9]\d*$/.test(amount) && Number(amount) <= 256 && Number(amount) !== clusterSize))
  const confirmLabel = action === 'restart' || action === 'reload' || action === 'stop' ? label + ' processo' : label
  return <dialog className="pm2-dialog" ref={dialog} onCancel={cancel} aria-labelledby="pm2-confirm-title">
    <h2 id="pm2-confirm-title">{label}{p ? ' · ' + p.name : ''}?</h2>
    {p && <p>{action === 'scale' ? clusterSize + ' instâncias no cluster' : '#' + p.id} · {p.namespace || 'Sem namespace'}</p>}
    <p>{valid ? description[action] : 'Os dados mudaram. Feche e confira a lista atualizada.'}</p>
    {action === 'scale' && <label className="pm2-scale">Total de instâncias (1 a 256)<input type="number" min="1" max="256" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>}
    <div><button className="button" autoFocus onClick={cancel}>Cancelar</button><button className="button primary" disabled={!canConfirm} onClick={() => confirm(action === 'scale' ? Number(amount) : undefined)}>{confirmLabel}</button></div>
  </dialog>
}

function Detail({ process: p, history, disabled, scalable, run }: { process: Pm2Process; history: Pm2Snapshot[]; disabled: boolean; scalable: boolean; run: (p: Pm2Process, action: Command) => void }) {
  const [metric, setMetric] = useState<'cpu' | 'memoryBytes' | 'restarts'>('cpu')
  const metrics = { cpu: { label: 'CPU', format: percent, color: '--mint' }, memoryBytes: { label: 'Memória', format: bytes, color: '--berry' },
    restarts: { label: 'Reinícios', format: count, color: '--gold' } }
  const current = metrics[metric]
  const data = history.map((s) => s.processes.find((row) => row.id === p.id && row.name === p.name && row.namespace === p.namespace)?.[metric] ?? null)
  const available = actions(p)
  const primary = available.filter((action) => action === 'restart' || action === 'start' || action === 'stop')
  function commandButton(command: Command) {
    const shellView = isShellView(command)
    const Icon = shellView ? shellIcons[command] : actionIcons[command]
    return <button key={command} className="button" disabled={disabled || (command === 'scale' && !scalable)} onClick={() => run(p, command)}>
      <Icon size={14} />{shellView ? shellLabels[command] : actionLabels[command]}</button>
  }
  return <aside className="pm2-detail" id="pm2-details" aria-label="Detalhes do processo">
    <div className="pm2-section-head"><h2><CircuitBoard size={17} />Detalhes do processo</h2></div>
    <div className="pm2-detail-inner"><div className="pm2-detail-title"><h3>{p.name}</h3><ProcessStatus status={p.status} /></div>
      <p className="pm2-ident">#{p.id} · {p.namespace || 'Sem namespace'}</p>
      <div className="pm2-actions">{primary.map(commandButton)}{commandButton('logs')}
        <details className="pm2-more" key={processKey(p)}><summary><MoreHorizontal size={15}/>Mais ações<ChevronDown size={13}/></summary>
          <div>{commandButton('shell')}{commandButton('describe')}{commandButton('monit')}
            {available.includes('reload') && commandButton('reload')}{isCluster(p) && commandButton('scale')}
            {isCluster(p) && !scalable && <p className="pm2-caption">O nome deste cluster também é usado por outro aplicativo.</p>}
            {commandButton('delete')}</div></details></div>
      <dl className="pm2-facts"><div><dt>PID</dt><dd>{p.pid ?? '—'}</dd></div>
        <div><dt>Modo</dt><dd>{isCluster(p) ? 'Cluster' : p.mode === 'fork_mode' || p.mode === 'fork' ? 'Fork' : p.mode || '—'}</dd></div>
        <div><dt>Ciclo atual</dt><dd>{uptime(p, history[history.length - 1].sampledAt)}</dd></div>
        <div><dt>Vigia de arquivos</dt><dd>{p.watching ? 'Ativo' : 'Inativo'}</dd></div></dl>
      <dl className="pm2-paths"><div><dt>Portas TCP</dt><dd>{portsText(p.ports)}</dd></div>
        <div><dt>Versão</dt><dd>{p.version || '—'}</dd></div>
        <div><dt>Pasta</dt><dd>{p.cwd || '—'}</dd></div>
        <div><dt>Script</dt><dd>{p.script || '—'}</dd></div></dl>
      <div className="pm2-metrics" role="group" aria-label="Histórico do processo">
        {(Object.keys(metrics) as (keyof typeof metrics)[]).map((key) => <button key={key} aria-pressed={metric === key} onClick={() => setMetric(key)}>
          <span>{metrics[key].label}</span><strong>{valueText(p[key], metrics[key].format)}</strong></button>)}</div>
      <Trend history={history} label={'Histórico de ' + current.label + ' de ' + p.name} format={current.format} stepped={metric === 'restarts'}
        traces={[{ label: metric === 'restarts' ? 'Reinícios acumulados' : current.label, color: current.color, values: data }]} />
      {metric === 'restarts' && <p className="pm2-caption">Total acumulado informado pelo PM2.</p>}
    </div>
  </aside>
}

function Notice({ children, tone = 'quiet' }: { children: ReactNode; tone?: 'quiet' | 'error' | 'ok' }) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'ok' ? Check : Activity
  return <div className={'pm2-notice ' + tone} role={tone === 'error' ? 'alert' : 'status'}><Icon size={16} /><div>{children}</div></div>
}

function ListActions({ canStart, canSave, startFile, select }: { canStart: boolean; canSave: boolean; startFile: () => void; select: (action: Pm2StateAction) => void }) {
  const menu = useRef<HTMLDetailsElement>(null)
  function close() {
    if (menu.current) { menu.current.open = false; menu.current.querySelector('summary')?.focus() }
  }
  return <details className="pm2-session" ref={menu} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
  }} onKeyDown={(event) => { if (event.key === 'Escape') close() }}>
    <summary><MoreHorizontal size={15}/>Gerenciar lista<ChevronDown size={13}/></summary>
    <div><button className="button" disabled={!canStart} onClick={() => { close(); startFile() }}><FilePlus2 size={14}/>Iniciar arquivo…</button>
      <button className="button" disabled={!canSave} onClick={() => { close(); select('save') }}><Save size={14}/>Salvar lista</button>
      <button className="button" disabled={!canStart} onClick={() => { close(); select('resurrect') }}><RotateCcw size={14}/>Restaurar lista</button></div>
  </details>
}

export function Pm2Panel({ active = true }: { active?: boolean }) {
  const { history, latest, refreshing, refresh, error, stale } = usePm2Monitor(active)
  const [search, setSearch] = useState('')
  const [namespace, setNamespace] = useState('')
  const [status, setStatus] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)
  useEffect(() => {
    if (!notice?.ok) return
    const timer = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(timer)
  }, [notice])
  const processes = latest?.processes ?? []
  const query = search.trim().toLocaleLowerCase('pt-BR')
  const filtered = processes.filter((p) => (!namespace || p.namespace === namespace) && (!status || p.status === status)
    && (!query || p.name.toLocaleLowerCase('pt-BR').includes(query) || String(p.id) === query.replace(/^#/, '')))
  const selected = chosen === null ? filtered[0] : filtered.find((p) => processKey(p) === chosen)
  const pick = (p: Pm2Process) => {
    setChosen(processKey(p))
    if (window.matchMedia('(max-width: 1040px)').matches) requestAnimationFrame(() => document.getElementById('pm2-details')?.scrollIntoView({ block: 'nearest' }))
  }
  const scalable = (p: Pm2Process) => isCluster(p) && processes.every((row) => row.name !== p.name || (row.namespace === p.namespace && isCluster(row)))
  const valid = (p: Pm2Process, command: Command) => !stale && processes.some((row) =>
    processKey(row) === processKey(p) && (isShellView(command) || (command === 'scale' ? scalable(row) : actions(row).includes(command))))
  async function perform(operation: () => Promise<string | null>, failureContext?: string) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setSelection(null)
    setNotice(null)
    try {
      const text = await operation()
      if (text) setNotice({ ok: true, text })
    } catch (failure) {
      setNotice({ ok: false, text: (failureContext ? failureContext + ' · ' : '') + appError(failure).message })
    } finally {
      setBusy(false)
      lock.current = false
      refresh()
    }
  }
  function execute(p: Pm2Process, action: Command, instances?: number) {
    if (!valid(p, action) || (action === 'scale' && (!instances || !Number.isSafeInteger(instances) || instances < 1 || instances > 256))) return
    const identity = p.name + ' (#' + p.id + ')'
    void perform(async () => {
      if (isShellView(action)) {
        await pm2.openShell(p.id, p.name, action)
        return action === 'monit' ? shellSuccess.monit + '.' : shellSuccess[action] + ' · ' + identity
      }
      if (action === 'scale') await pm2.scale(p.id, p.name, instances!)
      else await pm2.action(p.id, p.name, action)
      return actionSuccess[action] + ' · ' + identity
    }, identity)
  }
  function request(p: Pm2Process, action: Command) {
    if (lock.current || !valid(p, action)) return
    if (action === 'start' || isShellView(action)) execute(p, action)
    else setSelection({ process: p, action })
  }
  const canManage = !!latest && !stale && !busy
  const canStart = !busy && (canManage || error?.kind === 'pm2_daemon')
  const selectionValid = !!selection && (selection.action === 'resurrect' ? canStart : canManage && (!('process' in selection) || valid(selection.process, selection.action)))
  const listActions = <ListActions canStart={canStart} canSave={canManage} select={(action) => setSelection({action})}
    startFile={() => void perform(async () => await pm2.startFile() ? 'Arquivo iniciado no PM2.' : null)} />
  function confirm(instances?: number) {
    if (!selection || !selectionValid) return
    if ('process' in selection) execute(selection.process, selection.action, instances)
    else void perform(async () => {
      await pm2.stateAction(selection.action)
      return selection.action === 'save' ? 'Lista de processos salva.' : 'Restauração da lista solicitada.'
    })
  }
  function clearFilters() { setSearch(''); setNamespace(''); setStatus(''); setChosen(null) }
  if (!active) return null
  return <main className="pm2-panel" aria-label="Monitor do PM2"><div className="pm2-wrap">
    <header className="pm2-title"><div className="pm2-monogram"><Activity size={23} /></div><h1>Monitor do PM2</h1>
      <div className="pm2-sync">{latest && <span className={'pm2-fresh ' + (stale ? 'stale' : '')}><i />{stale ? 'Dados desatualizados' : 'Ao vivo'}<time dateTime={new Date(latest.sampledAt).toISOString()}>{clock.format(latest.sampledAt)}</time></span>}
        <button className="button" aria-label="Atualizar monitor" title="Atualizar monitor" disabled={refreshing} onClick={refresh}><RefreshCw size={15} className={refreshing ? 'pm2-spin' : ''} /><span>Atualizar</span></button></div>
    </header>
    {error && <Notice tone="error"><strong>{latest ? 'A atualização falhou.' : 'PM2 indisponível.'}</strong> {error.message}</Notice>}
    {!latest && error?.kind === 'pm2_daemon' && <section className="pm2-processes"><div className="pm2-section-head"><h2><Layers3 size={17}/>Processos</h2>{listActions}</div></section>}
    {!latest && !error && <div className="pm2-loading" role="status"><LoaderCircle size={20} className="pm2-spin" />Consultando o PM2…</div>}
    {latest && <><HostCards history={history} /><div className="pm2-process-layout">
      <section className="pm2-processes" aria-label="Processos do PM2"><div className="pm2-section-head"><h2><Layers3 size={17} />Processos</h2>
        <span>{filtered.length === processes.length ? String(processes.length) : filtered.length + ' de ' + processes.length}</span>
        {listActions}</div>
        {processes.length > 0 && <div className="pm2-filters"><label className="search-field"><Search size={15} /><input aria-label="Buscar processo" placeholder="Buscar por nome ou ID" value={search} onChange={(event) => { setSearch(event.target.value); setChosen(null) }} /></label>
          <select aria-label="Filtrar por namespace" value={namespace} onChange={(event) => { setNamespace(event.target.value); setChosen(null) }}><option value="">Todos os namespaces</option>
            {Array.from(new Set([...processes.map((p) => p.namespace), namespace])).filter(Boolean).sort().map((n) => <option key={n}>{n}</option>)}</select>
          <select aria-label="Filtrar por estado" value={status} onChange={(event) => { setStatus(event.target.value); setChosen(null) }}><option value="">Todos os estados</option>
            {Array.from(new Set([...processes.map((p) => p.status), status])).filter(Boolean).sort().map((s) => <option key={s} value={s}>{statusName(s)}</option>)}</select></div>}
        {!processes.length ? <div className="pm2-empty"><Layers3 size={23} /><strong>Nenhum processo gerenciado pelo PM2.</strong></div>
          : !filtered.length ? <div className="pm2-empty"><Search size={22} /><strong>Nenhum processo corresponde aos filtros.</strong>
            <button className="button" onClick={clearFilters}>Limpar filtros</button></div>
          : <div className="pm2-table-scroll"><table><thead><tr><th>Processo</th><th>Estado</th><th>Portas TCP</th><th>CPU</th><th>Memória</th><th>Reinícios</th></tr></thead>
            <tbody>{filtered.map((p) => <tr key={processKey(p)} className={selected && processKey(selected) === processKey(p) ? 'selected' : ''} onClick={() => pick(p)}>
              <th scope="row"><button aria-label={'Ver detalhes de ' + p.name + ' (#' + p.id + ')'} aria-controls="pm2-details" onClick={(event) => { event.stopPropagation(); pick(p) }}>
                <strong>{p.name}</strong><small>#{p.id} · {p.namespace || 'Sem namespace'}</small></button></th><td><ProcessStatus status={p.status} /></td>
              <td className="pm2-ports">{portsText(p.ports)}</td><td>{valueText(p.cpu, percent)}</td><td>{valueText(p.memoryBytes, bytes)}</td><td>{valueText(p.restarts, count)}</td>
            </tr>)}</tbody></table></div>}
      </section>
      {selected && <Detail process={selected} history={history} disabled={busy || stale} scalable={scalable(selected)} run={request} />}
    </div></>}
    {notice && <div className="pm2-feedback"><Notice tone={notice.ok ? 'ok' : 'error'}>{notice.text}
      <button className="icon-button" aria-label="Fechar mensagem" onClick={() => setNotice(null)}><X size={14}/></button></Notice></div>}
    {selection && <Confirmation selection={selection} valid={selectionValid}
      clusterSize={'process' in selection ? processes.filter((p) => p.name === selection.process.name && p.namespace === selection.process.namespace && isCluster(p)).length : 0}
      cancel={() => setSelection(null)} confirm={confirm} />}
  </div></main>
}
