import { useEffect, useRef, useState } from 'react'
import { Leaf, LoaderCircle, X } from 'lucide-react'
import { appError, call } from '../controllers/api'
import './host-optimizer.css'

interface Result { key: string; name: string; pid: number; status: 'closed' | 'pending' | 'skipped' | 'trimmed'; reducedBytes?: number | null }
const reasons = {
  pm2: 'PM2 e seus subprocessos', infrastructure: 'Serviços, bancos e dependências', sessionOrWindow: 'Sessão ou janela fora dos critérios',
  unverified: 'Verificação inconclusiva', active: 'Atividade recente, pouco uso de RAM ou ajuste recente', noPressure: 'Sem necessidade confirmada de reduzir memória',
}
interface Report {
  results: Result[]
  closedCount: number
  closedMemoryBytes: number
  availableBeforeBytes: number | null
  availableAfterBytes: number | null
  protectedCount?: number
  scannedCount?: number
  eligibleCount?: number
  trimmedCount?: number
  trimmedMemoryBytes?: number | null
  memoryPressure?: boolean | null
  preserved?: Record<keyof typeof reasons, number>
}
const states = { closed: 'Fechado', pending: 'Continua aberto', skipped: 'Ignorado', trimmed: 'Memória ajustada · aberto' }

export function HostOptimizer({ formatBytes, onFinished, onInspectMemory }: {
  formatBytes: (bytes: number) => string; onFinished: () => void; onInspectMemory?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const generation = useRef(0)
  const lock = useRef(false)
  useEffect(() => {
    if (!open) return
    const el = dialog.current
    el?.showModal()
    return () => { if (el?.open) el.close() }
  }, [open])
  useEffect(() => () => { generation.current++ }, [])
  async function optimize() {
    if (lock.current) return
    lock.current = true
    const token = ++generation.current
    setReport(null)
    setError('')
    setOpen(true)
    setWorking(true)
    try {
      const response = await call<Report>('optimizer_close')
      if (token === generation.current) {
        setReport(response)
        onFinished()
      }
    } catch (failure) {
      if (token === generation.current) setError(appError(failure).message)
    } finally {
      lock.current = false
      if (token === generation.current) setWorking(false)
    }
  }
  const pending = report?.results.filter(r => r.status === 'pending').length ?? 0
  const skipped = report?.results.filter(r => r.status === 'skipped').length ?? 0
  return <><button type="button" className="button optimizer-launch" disabled={working} onClick={() => void optimize()}
    title="Analisar os processos do Windows e otimizar os aplicativos elegíveis">
    <Leaf size={15} />Otimizar agora</button>
    {open && <dialog ref={dialog} className="optimizer-dialog" aria-labelledby="optimizer-title"
      onCancel={event => { event.preventDefault(); if (!working) setOpen(false) }}>
      <header><h2 id="optimizer-title" aria-live="polite">{report ? 'Resultado da otimização' : 'Otimizar agora'}</h2>
        <button type="button" className="icon-button" aria-label="Fechar otimizador" disabled={working} onClick={() => setOpen(false)}><X size={16}/></button></header>
      {working && <p role="status"><LoaderCircle size={16} className="pm2-spin"/> Analisando os processos do Windows e o uso de memória…</p>}
      {error && <p role="alert">{error}</p>}
      {report && <>
        {typeof report.scannedCount === 'number' && <p><strong>Processos examinados: {report.scannedCount}.</strong>
          {typeof report.eligibleCount === 'number' && ' Elegíveis para otimização: ' + report.eligibleCount + '.'}</p>}
        {report.memoryPressure !== undefined && <p>{report.memoryPressure === null ? 'Sinal de pressão de memória indisponível nesta leitura.'
          : report.memoryPressure ? 'O Windows sinalizou pouca RAM disponível.' : 'O Windows não sinalizou pressão de memória.'}</p>}
        {report.results.length ? <>
          <dl className="optimizer-totals"><div><dt>Fechados</dt><dd>{report.closedCount}</dd></div>
            {typeof report.trimmedCount === 'number' && <div><dt>RAM ajustada</dt><dd>{report.trimmedCount}</dd></div>}
            <div><dt>Fechamento pendente</dt><dd>{pending}</dd></div><div><dt>Ignorados</dt><dd>{skipped}</dd></div></dl>
          <ul className="optimizer-results">{report.results.map(r => <li key={r.key + ':' + r.pid}>
            <span>{r.name} <small>PID {r.pid}</small></span><b>{states[r.status]}
              {r.status === 'trimmed' && typeof r.reducedBytes === 'number' && r.reducedBytes > 0 && <small> −{formatBytes(r.reducedBytes)} em RAM</small>}</b>
          </li>)}</ul>
          {pending > 0 && <p>Alguns aplicativos ainda estão abertos após o pedido de encerramento.</p>}
          {skipped > 0 && <p>Instâncias ignoradas já saíram ou deixaram de atender aos critérios de otimização no momento da ação.</p>}
          {report.closedCount > 0 && <p>Antes de fechar, os processos encerrados ocupavam <strong>{formatBytes(report.closedMemoryBytes)}</strong> de RAM.</p>}
          {typeof report.trimmedMemoryBytes === 'number' && report.trimmedMemoryBytes > 0 &&
            <p>A memória residente dos aplicativos ajustados diminuiu <strong>{formatBytes(report.trimmedMemoryBytes)}</strong> na medição após o ajuste. Eles continuam abertos.</p>}
        </> : <p className="optimizer-empty">{report.eligibleCount === 0 ? 'Nenhum processo atendeu aos critérios de otimização nesta leitura.' : 'Nenhuma ação registrada nesta leitura.'}</p>}
        {typeof report.availableBeforeBytes === 'number' && typeof report.availableAfterBytes === 'number' &&
          <p className="optimizer-ram"><strong>RAM disponível no computador</strong><span>{formatBytes(report.availableBeforeBytes)} → {formatBytes(report.availableAfterBytes)}</span>
            <small>Leituras antes e depois do pedido. Outros aplicativos também podem alterar esse total.</small></p>}
        {report.preserved && <details className="optimizer-preserved"><summary>Motivos para preservar processos</summary>
          <dl>{(Object.keys(reasons) as (keyof typeof reasons)[]).map(reason => <div key={reason}><dt>{reasons[reason]}</dt><dd>{report.preserved![reason]}</dd></div>)}</dl></details>}
        {typeof report.protectedCount === 'number' && report.protectedCount > 0 && <p>{report.protectedCount} {report.protectedCount === 1 ? 'processo do PM2 protegido' : 'processos do PM2 protegidos'}. A contagem inclui subprocessos.</p>}
        <p>Bancos de dados e serviços de infraestrutura são preservados.</p>
      </>}
      {!working && <footer>{error && <button type="button" className="button" onClick={() => void optimize()}>Tentar novamente</button>}
        {report && onInspectMemory && <button type="button" className="button" onClick={() => { setOpen(false); onInspectMemory() }}>Ver quem usa a memória</button>}
        <button type="button" className="button" onClick={() => setOpen(false)}>Fechar</button></footer>}
    </dialog>}
  </>
}
