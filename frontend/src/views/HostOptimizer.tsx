import { useEffect, useRef, useState } from 'react'
import { Leaf, LoaderCircle, X } from 'lucide-react'
import { appError, call } from '../controllers/api'
import './host-optimizer.css'

interface Result { key: string; name: string; pid: number; status: 'closed' | 'pending' | 'skipped' }
interface Report {
  results: Result[]
  closedCount: number
  closedMemoryBytes: number
  availableBeforeBytes: number | null
  availableAfterBytes: number | null
  protectedCount?: number
}
const states = { closed: 'Fechado', pending: 'Continua aberto', skipped: 'Ignorado' }

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
    title="Solicitar o encerramento normal dos utilitários opcionais minimizados">
    <Leaf size={15} />Otimizar agora</button>
    {open && <dialog ref={dialog} className="optimizer-dialog" aria-labelledby="optimizer-title"
      onCancel={event => { event.preventDefault(); if (!working) setOpen(false) }}>
      <header><h2 id="optimizer-title" aria-live="polite">{report ? 'Resultado da otimização' : 'Otimizar agora'}</h2>
        <button type="button" className="icon-button" aria-label="Fechar otimizador" disabled={working} onClick={() => setOpen(false)}><X size={16}/></button></header>
      {working && <p role="status"><LoaderCircle size={16} className="pm2-spin"/> Verificando os utilitários minimizados e solicitando o encerramento…</p>}
      {error && <p role="alert">{error}</p>}
      {report && <>
        {report.results.length ? <>
          <dl className="optimizer-totals"><div><dt>Fechados</dt><dd>{report.closedCount}</dd></div>
            <div><dt>Continuam abertos</dt><dd>{pending}</dd></div><div><dt>Ignorados</dt><dd>{skipped}</dd></div></dl>
          <ul className="optimizer-results">{report.results.map(r => <li key={r.key + ':' + r.pid}>
            <span>{r.name} <small>PID {r.pid}</small></span><b>{states[r.status]}</b>
          </li>)}</ul>
          {pending > 0 && <p>Alguns aplicativos ainda estão abertos após o pedido de encerramento.</p>}
          {skipped > 0 && <p>Instâncias ignoradas já saíram ou deixaram de atender aos critérios de encerramento.</p>}
          {report.closedCount > 0 && <p>Antes de fechar, os processos encerrados ocupavam <strong>{formatBytes(report.closedMemoryBytes)}</strong> de RAM.</p>}
        </> : <p className="optimizer-empty">Nenhum utilitário opcional minimizado disponível para encerrar.</p>}
        {typeof report.availableBeforeBytes === 'number' && typeof report.availableAfterBytes === 'number' &&
          <p className="optimizer-ram"><strong>RAM disponível no computador</strong><span>{formatBytes(report.availableBeforeBytes)} → {formatBytes(report.availableAfterBytes)}</span>
            <small>Leituras antes e depois do pedido. Outros aplicativos também podem alterar esse total.</small></p>}
        {typeof report.protectedCount === 'number' && report.protectedCount > 0 && <p>{report.protectedCount} {report.protectedCount === 1 ? 'processo do PM2 protegido' : 'processos do PM2 protegidos'}. A contagem inclui subprocessos.</p>}
        <p>Bancos de dados ficam fora da lista de utilitários para encerramento.</p>
      </>}
      {!working && <footer>{error && <button type="button" className="button" onClick={() => void optimize()}>Tentar novamente</button>}
        {report && onInspectMemory && <button type="button" className="button" onClick={() => { setOpen(false); onInspectMemory() }}>Ver quem usa a memória</button>}
        <button type="button" className="button" onClick={() => setOpen(false)}>Fechar</button></footer>}
    </dialog>}
  </>
}
