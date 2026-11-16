import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, File, LoaderCircle, LockKeyhole, X } from 'lucide-react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { appError, sql } from '../controllers/api'
import { engines, type Engine } from '../models/engines'
import type { AppError, Connection } from '../models/sql'

export function OtherConnectionDialog({ engine, onClose, onConnected }: {
  engine: Exclude<Engine, 'sqlServer'>
  onClose: () => void
  onConnected: (connection: Connection) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const [host, setHost] = useState('localhost')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const info = engines[engine]
  const localFile = engine === 'sqlite'
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(host.trim().toLowerCase())

  useEffect(() => { dialog.current?.showModal() }, [])

  async function chooseFile() {
    try {
      const path = await invoke<string | null>('choose_sqlite_file')
      if (path && file.current) file.current.value = path
    } catch (failure) {
      setError(appError(failure))
    }
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)
    const data = new FormData(event.currentTarget)
    try {
      const connection = await sql.connect({
        engine, transport: localFile ? 'local' : 'network', authentication: 'sql',
        host: String(data.get('host') ?? '').trim(),
        port: Number(data.get('port') ?? 0),
        username: String(data.get('username') ?? '').trim(),
        password: String(data.get('password') ?? ''),
        database: String(data.get('database') ?? '').trim() || undefined,
        path: String(data.get('path') ?? '').trim() || undefined,
      }, false, false)
      onConnected(connection)
    } catch (failure) {
      setError(appError(failure))
    } finally {
      data.delete('password')
      setLoading(false)
    }
  }

  return <dialog ref={dialog} className="connection-dialog" aria-labelledby="connection-title"
    onCancel={(event) => { event.preventDefault(); if (!loading) onClose() }}>
    <form onSubmit={connect}>
      <div className="dialog-top"><span className="engine-icon"><img src={info.icon} alt="" /></span>
        <button type="button" className="icon-button" aria-label="Fechar" onClick={onClose} disabled={loading}><X size={18} /></button>
      </div>
      <h2 id="connection-title">{localFile ? 'Abrir SQLite' : 'Conectar ao ' + info.name}</h2>
      <p>{localFile ? 'Escolha um arquivo de banco SQLite existente.' : 'Informe o servidor e o usuário com acesso ao banco.'}</p>
      <fieldset disabled={loading}>
        {localFile ? <label>Arquivo do banco<div className="sqlite-file-field">
          <input ref={file} name="path" autoFocus required autoComplete="off" placeholder="C:\Dados\banco.sqlite" />
          {isTauri() && <button type="button" className="button" onClick={() => void chooseFile()}><File size={15} /> Procurar</button>}
        </div></label> : <>
          <div className="form-row">
            <label>Servidor<input name="host" autoFocus required maxLength={253} value={host}
              onChange={(event) => setHost(event.target.value)} autoComplete="off" spellCheck={false} /></label>
            <label>Porta<input name="port" type="number" defaultValue={info.port} min={1} max={65535} required /></label>
          </div>
          {engine === 'postgres' && <label>Banco inicial<input name="database" required defaultValue="postgres" maxLength={63} autoComplete="off" /></label>}
          <label>Usuário<input name="username" required maxLength={128} autoComplete="off" /></label>
          <label>Senha<input name="password" type="password" maxLength={256} autoComplete="off" /></label>
        </>}
      </fieldset>
      <div className="tls-note"><LockKeyhole size={15} />{localFile ? 'Arquivo aberto em modo de leitura.' :
        loopback ? 'Conexão local neste computador.' : 'Criptografia e validação do certificado do servidor.'}</div>
      {error && <div className="form-error" role="alert">{error.message}</div>}
      <div className="dialog-actions">
        <button type="button" className="button" disabled={loading} onClick={onClose}>Cancelar</button>
        <button className="button primary" disabled={loading}>{loading ?
          <><LoaderCircle className="spin" size={16} /> Conectando…</> :
          <>{localFile ? 'Abrir arquivo' : 'Conectar'} <ArrowRight size={16} /></>}</button>
      </div>
    </form>
  </dialog>
}
