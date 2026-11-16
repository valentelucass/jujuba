import { useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { appError, noSql } from '../controllers/api'
import { engines, type NoSqlEngine } from '../models/engines'
import type { AppError, Connection } from '../models/sql'

export function NoSqlConnectionForm({ engine, loading, setLoading, onClose, onConnected }: {
  engine: NoSqlEngine
  loading: boolean
  setLoading: (loading: boolean) => void
  onClose: () => void
  onConnected: (connection: Connection) => void
}) {
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const info = engines[engine]

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)
    const data = new FormData(event.currentTarget)
    const uri = String(data.get('uri') ?? '')
    data.delete('uri')
    try {
      onConnected(await noSql.connect(engine, uri))
    } catch (failure) {
      setError(appError(failure))
    } finally {
      setLoading(false)
    }
  }

  return <section className="connection-dialog connection-form" aria-labelledby="connection-title"
    onKeyDown={(event) => { if (event.key === 'Escape' && !loading) onClose() }}>
    <form onSubmit={connect}>
      <div className="dialog-top"><span className="engine-icon"><img src={info.icon} alt="" /></span>
        <button type="button" className="icon-button" aria-label="Voltar aos tipos de banco" onClick={onClose} disabled={loading}><ArrowLeft size={18} /></button>
      </div>
      <h2 id="connection-title">Conectar ao {info.name}</h2>
      <fieldset disabled={loading}>
        <div className="password-group"><label htmlFor="nosql-uri">URI de conexão</label>
          <div className="password-field">
            <input id="nosql-uri" name="uri" type={visible ? 'text' : 'password'} autoFocus required maxLength={8192}
              placeholder={engine + '://localhost:' + info.port} autoComplete="off" spellCheck={false} />
            <button type="button" className="icon-button" aria-label={visible ? 'Ocultar URI' : 'Mostrar URI'}
              onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
        </div>
        <p className="tls-note">{engine === 'mongodb' ? 'Aceita mongodb:// e mongodb+srv://.' : 'Aceita redis:// e rediss://.'}</p>
      </fieldset>
      {error && <div className="form-error" role="alert">{error.message}</div>}
      <div className="dialog-actions">
        <button type="button" className="button" disabled={loading} onClick={onClose}>Cancelar</button>
        <button className="button primary" disabled={loading}>{loading ?
          <><LoaderCircle className="spin" size={16} /> Conectando…</> :
          <>Conectar <ArrowRight size={16} /></>}</button>
      </div>
    </form>
  </section>
}
