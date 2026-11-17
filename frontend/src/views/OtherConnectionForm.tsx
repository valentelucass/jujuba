
import { useMemo, useState, type FormEvent } from 'react'
import { ArrowRight, File, LoaderCircle, LockKeyhole, X } from 'lucide-react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { appError, sql } from '../controllers/api'
import { readDatabasePreference, rememberDatabase } from '../controllers/connectionPreference'
import { useRemote } from '../controllers/useRemote'
import { engines, type SqlEngine } from '../models/engines'
import type { AppError, Connection } from '../models/sql'

export function OtherConnectionForm({ engine, onClose, onConnected, loading, setLoading }: {
  loading: boolean
  setLoading: (loading: boolean) => void
  engine: Exclude<SqlEngine, 'sqlServer'>
  onClose: () => void
  onConnected: (connection: Connection) => void
}) {
  const info = engines[engine]
  const localFile = engine === 'sqlite'
  const [saved] = useState(() => readDatabasePreference(engine))
  const [host, setHost] = useState(saved.host ?? 'localhost')
  const [port, setPort] = useState(String(saved.port ?? info.port))
  const [username, setUsername] = useState(saved.username ?? '')
  const [database, setDatabase] = useState(saved.database ?? 'postgres')
  const [path, setPath] = useState(saved.path ?? '')
  const [error, setError] = useState<AppError | null>(null)
  const [credentialRevision, setCredentialRevision] = useState(0)
  const [manual, setManual] = useState('')
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(host.trim().toLowerCase())
  const profile = useMemo(() => ({
    engine,
    transport: localFile ? 'local' as const : 'network' as const,
    authentication: 'sql' as const,
    host: host.trim(),
    port: Number(port),
    username: username.trim(),
    database: engine === 'postgres' ? database.trim() : undefined,
    path: localFile ? path.trim() : undefined,
  }), [engine, localFile, host, port, username, database, path])
  const profileKey = JSON.stringify([engine, profile.host.toLowerCase(), profile.port, profile.username])
  const lookup = useMemo(() => () => sql.hasSavedPassword(profile), [profile, credentialRevision])
  const passwordStatus = useRemote(!localFile && !!profile.host && !!profile.username && profile.port > 0 &&
    profile.port <= 65535 ? lookup : null)
  const hasSaved = passwordStatus.status === 'ready' && passwordStatus.data
  const useSaved = hasSaved && manual !== profileKey

  async function chooseFile() {
    try {
      const next = await invoke<string | null>('choose_sqlite_file')
      if (next) setPath(next)
    } catch (failure) {
      setError(appError(failure))
    }
  }

  async function forget() {
    try {
      await sql.forgetPassword(profile)
      setManual(profileKey)
      setCredentialRevision((value) => value + 1)
    } catch (failure) {
      setError(appError(failure))
    }
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading || passwordStatus.status === 'loading') return
    const data = new FormData(event.currentTarget)
    setLoading(true)
    setError(null)
    try {
      const active = await sql.connect({
        ...profile,
        port: localFile ? 0 : profile.port,
        password: localFile || useSaved ? undefined : String(data.get('password') ?? ''),
      }, useSaved)
      rememberDatabase(engine, profile)
      onConnected(active)
    } catch (failure) {
      const issue = appError(failure)
      if (useSaved && ['authentication', 'credentials'].includes(issue.kind)) setManual(profileKey)
      setError(issue)
    } finally {
      data.delete('password')
      setLoading(false)
    }
  }

  return <section className="connection-dialog connection-form" aria-labelledby="connection-title"
    onKeyDown={(event) => { if (event.key === 'Escape' && !loading) onClose() }}>
    <form onSubmit={connect}>
      <div className="dialog-top"><span className="engine-icon"><img src={info.icon} alt="" /></span>
        <button type="button" className="icon-button" aria-label="Voltar aos tipos de banco" onClick={onClose} disabled={loading}><X size={18} /></button>
      </div>
      <h2 id="connection-title">{localFile ? 'Abrir SQLite' : 'Conectar ao ' + info.name}</h2>
      <p>{localFile ? 'Escolha um arquivo de banco SQLite existente.' : 'Informe o servidor e o usuário com acesso ao banco.'}</p>
      <fieldset disabled={loading}>
        {localFile ? <label>Arquivo do banco<div className="sqlite-file-field">
          <input name="path" autoFocus required autoComplete="off" value={path}
            onChange={(event) => setPath(event.target.value)} placeholder="C:\Dados\banco.sqlite" />
          {isTauri() && <button type="button" className="button" onClick={() => void chooseFile()}><File size={15} /> Procurar</button>}
        </div></label> : <>
          <div className="form-row">
            <label>Servidor<input name="host" autoFocus required maxLength={253} value={host}
              onChange={(event) => setHost(event.target.value)} autoComplete="off" spellCheck={false} /></label>
            <label>Porta<input name="port" type="number" value={port} onChange={(event) => setPort(event.target.value)}
              min={1} max={65535} required /></label>
          </div>
          {engine === 'postgres' && <label>Banco inicial<input name="database" required value={database}
            onChange={(event) => setDatabase(event.target.value)} maxLength={63} autoComplete="off" /></label>}
          <label>Usuário<input name="username" required value={username} onChange={(event) => setUsername(event.target.value)}
            maxLength={128} autoComplete="off" /></label>
          {useSaved ? <p className="saved-password"><LockKeyhole size={15} />Senha salva neste PC</p> :
            <label>Senha<input key={profileKey} name="password" type="password" maxLength={256}
              autoComplete="off" onChange={() => setManual(profileKey)} /></label>}
          {hasSaved && <div className="saved-password-actions">
            {useSaved && <button type="button" className="detail-link" onClick={() => setManual(profileKey)}>Digitar outra senha</button>}
            <button type="button" className="detail-link" onClick={() => void forget()}>Esquecer senha salva</button>
          </div>}
        </>}
      </fieldset>
      <div className="tls-note"><LockKeyhole size={15} />{localFile ? 'Arquivo aberto em modo de leitura.' :
        loopback ? 'Conexão local neste computador.' : 'Criptografia e validação do certificado do servidor.'}</div>
      {error && <div className="form-error" role="alert">{error.message}</div>}
      <div className="dialog-actions">
        <button type="button" className="button" disabled={loading} onClick={onClose}>Cancelar</button>
        <button className="button primary" disabled={loading || passwordStatus.status === 'loading'}>{loading ?
          <><LoaderCircle className="spin" size={16} /> Conectando…</> :
          <>{localFile ? 'Abrir arquivo' : 'Conectar'} <ArrowRight size={16} /></>}</button>
      </div>
    </form>
  </section>
}
