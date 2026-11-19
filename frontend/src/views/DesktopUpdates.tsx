import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { openUrl } from '@tauri-apps/plugin-opener'
import { version as installedVersion } from '../../package.json'
import { Download, RefreshCw } from 'lucide-react'

const AUTO_CHECK_INTERVAL = 5 * 60_000
const FOCUS_CHECK_INTERVAL = 60_000
const releasePage = 'https://github.com/valentelucass/jujuba/releases/latest'
const attemptKey = 'jujuba.pending-installer'

function previousAttempt(): string {
  try {
    const attempt = JSON.parse(localStorage.getItem(attemptKey) ?? 'null')
    if (attempt?.from === installedVersion && typeof attempt.to === 'string' && /^\d+\.\d+\.\d+$/.test(attempt.to)) {
      return `A instalação da versão ${attempt.to} foi solicitada. Este aplicativo ainda está na versão ${installedVersion}.`
    }
  } catch { /* Optional local receipt. */ }
  return ''
}

function installError(cause: unknown, stage: 'download' | 'prepare' | 'install') {
  const detail = String(cause instanceof Error ? cause.message : cause)
  if (stage === 'prepare') return 'Falha ao preparar a sessão para a atualização. Salve seu trabalho e tente novamente.'
  if (/minisign|signature|assinatura|invalid pub/i.test(detail)) return 'A assinatura do pacote de atualização não passou na verificação. Consulte a release oficial antes de tentar novamente.'
  if (stage === 'download') return 'Falha no download do pacote pelo GitHub. Verifique a conexão e o acesso aos arquivos de releases.'
  if (/denied|negado|permission|permissão|os error (?:5|1260)\b|policy/i.test(detail)) return 'O Windows recusou a abertura do instalador. Em um computador corporativo, encaminhe o aviso do Windows à TI para verificar a política de instalação.'
  return 'O pacote foi baixado e verificado, mas o instalador não iniciou. Confira o aviso do Windows ou encaminhe-o à TI.'
}

export type PrepareUpdate = () => Promise<void | (() => void)>
const Updates = createContext<{
  open: () => void
  available: boolean
  version: string | null
  status: Status
  busy: boolean
  refresh: (manual: boolean) => Promise<void>
  install: (prepare?: PrepareUpdate) => Promise<void>
} | null>(null)

export function useDesktopUpdates() {
  return useContext(Updates)
}
type Status = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'error'

export function DesktopUpdates({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [version, setVersion] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [lastAttempt, setLastAttempt] = useState(previousAttempt)
  const [linkError, setLinkError] = useState(false)
  const resource = useRef<Update | null>(null)
  const checkInProgress = useRef(false)
  const manualCheck = useRef(false)
  const installInProgress = useRef(false)
  const prepareInstall = useRef<PrepareUpdate | undefined>(undefined)
  const lastCheck = useRef(-Infinity)
  const dialog = useRef<HTMLDialogElement>(null)
  const showingError = useRef(false)
  showingError.current = visible && status === 'error'
  const busy = status === 'downloading' || status === 'installing'

  const search = useCallback(async (manual: boolean) => {
    if (installInProgress.current || (!manual && showingError.current)) return
    manualCheck.current ||= manual
    if (checkInProgress.current) return
    checkInProgress.current = true
    lastCheck.current = Date.now()
    setStatus('checking')
    try {
      const found = await check({ timeout: 12000 })
      const previous = resource.current
      resource.current = found
      if (previous) void previous.close().catch(() => {})
      setVersion(found?.version ?? null)
      setStatus(found ? 'available' : 'current')
    } catch {
      setError('Não foi possível consultar o GitHub. Tente novamente em instantes.')
      setStatus(manualCheck.current ? 'error' : resource.current ? 'available' : 'idle')
    } finally {
      checkInProgress.current = false
      manualCheck.current = false
    }
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    const checkForUpdates = () => { void search(false) }
    const checkOnFocus = () => {
      if (Date.now() - lastCheck.current >= FOCUS_CHECK_INTERVAL) checkForUpdates()
    }
    const startup = window.setTimeout(checkOnFocus, 1000)
    const interval = window.setInterval(checkForUpdates, AUTO_CHECK_INTERVAL)
    window.addEventListener('focus', checkOnFocus)
    return () => {
      window.clearTimeout(startup)
      window.clearInterval(interval)
      window.removeEventListener('focus', checkOnFocus)
    }
  }, [search])

  useEffect(() => {
    if (visible && !dialog.current?.open) dialog.current?.showModal()
    if (!visible && dialog.current?.open) dialog.current.close()
  }, [visible])

  async function install(prepare = prepareInstall.current) {
    const update = resource.current
    if (!update || installInProgress.current) return
    if (checkInProgress.current) { setVisible(true); return }
    installInProgress.current = true
    prepareInstall.current = prepare
    setVisible(true)
    setStatus('downloading')
    setProgress(null)
    let total = 0
    let downloaded = 0
    let rollback: void | (() => void) = undefined
    let stage: 'download' | 'prepare' | 'install' = 'download'
    try {
      await update.download((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? 0
        if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          if (total > 0) setProgress(Math.min(100, Math.round(downloaded / total * 100)))
        }
      }, { timeout: 180000 })
      stage = 'prepare'
      rollback = await prepare?.()
      stage = 'install'
      try { localStorage.setItem(attemptKey, JSON.stringify({ from: installedVersion, to: update.version })) } catch { /* Optional local receipt. */ }
      setStatus('installing')
      await update.install()
    } catch (cause) {
      installInProgress.current = false
      let message = installError(cause, stage)
      try { rollback?.() } catch { message += ' Reabra a sessão de colaboração para continuar.' }
      setError(message)
      setStatus('error')
    }
  }

  if (!isTauri()) return children
  return <Updates.Provider value={{ available: version !== null, version, status, busy, refresh: search, install, open: () => {
    prepareInstall.current = undefined
    setVisible(true)
    void search(true)
  } }}>
    {children}
    <dialog ref={dialog} className="connection-dialog update-dialog" aria-labelledby="update-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) setVisible(false) }}>
      <h2 id="update-title">Atualizações do JUJUBA</h2>
      <small>Versão instalada neste computador · {installedVersion}</small>
      {lastAttempt && <p>{lastAttempt}</p>}
      <div role="status">
        {status === 'checking' && <p>Verificando se há uma nova versão…</p>}
        {status === 'current' && <p>Você já está na versão mais recente.</p>}
        {status === 'available' && <p>A versão <strong>{version}</strong> está disponível. Salve seu trabalho antes de atualizar. O aplicativo será fechado para a instalação.</p>}
        {status === 'downloading' && <><p>Baixando atualização{progress === null ? '…' : ' · ' + progress + '%'}</p>
          <progress aria-label="Progresso da atualização" max={100} value={progress ?? undefined} /></>}
        {status === 'installing' && <p>Pacote verificado. Abrindo o instalador do Windows…</p>}
      </div>
      {status === 'error' && <p role="alert">{error}</p>}
      {(status === 'error' || lastAttempt) && <p><a href={releasePage} onClick={event => {
        event.preventDefault()
        void openUrl(releasePage).catch(() => setLinkError(true))
      }}>Abrir a página oficial da atualização</a>{linkError && <small> · {releasePage}</small>}</p>}
      <div className="update-actions">
        <button className="button" disabled={busy} onClick={() => {
          setVisible(false)
          if (lastAttempt) {
            setLastAttempt('')
            try { localStorage.removeItem(attemptKey) } catch { /* Optional local receipt. */ }
          }
        }}>{version ? 'Mais tarde' : 'Fechar'}</button>
        {(status === 'available' || (status === 'error' && version)) &&
          <button className="button primary" onClick={() => void install()}><Download size={15} />Atualizar agora</button>}
        {(status === 'current' || (status === 'error' && !version)) &&
          <button className="button" onClick={() => void search(true)}><RefreshCw size={14} />Verificar novamente</button>}
      </div>
    </dialog>
  </Updates.Provider>
}

export function UpdateButton() {
  const updates = useContext(Updates)
  if (!updates) return <a className="update-button" href="https://github.com/valentelucass/jujuba/releases/latest"
    aria-label="Atualizações" title="Atualizações" target="_blank" rel="noopener noreferrer">
    <Download size={14} /><span>Atualizações</span>
  </a>
  const label = updates.version ? `Versão ${updates.version} disponível` : 'Atualizações'
  return <button type="button" className={`update-button${updates.available ? ' available' : ''}`}
    aria-label={label} title={label} onClick={updates.open}>
    <Download size={14} /><span>{label}</span>
  </button>
}
