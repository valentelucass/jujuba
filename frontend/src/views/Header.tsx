import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Database, GitBranch, Moon, Plug, Power, Search, Sun } from 'lucide-react'
import jujuba from '../assets/jujuba.png'
import type { Connection, Database as DatabaseName } from '../models/sql'
import { UpdateButton } from './DesktopUpdates'
import { useTheme } from './Theme'

export function Header({ connection, database, onConnect, onDisconnect, onDatabase, tools, disconnecting, connecting, onDiagrams, diagramActive }: {
  onDiagrams?: () => void
  diagramActive?: boolean
  tools?: ReactNode
  disconnecting?: boolean
  connecting?: boolean
  connection?: Connection
  database?: DatabaseName | null
  onConnect?: () => void
  onDisconnect?: () => void
  onDatabase?: (db: DatabaseName) => void
}) {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const dropdown = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function closeOnOutside(event: PointerEvent) {
      if (event.target instanceof Node && !dropdown.current?.contains(event.target)) setOpen(false)
    }
    if (!open) return
    document.addEventListener('pointerdown', closeOnOutside)
    return () => document.removeEventListener('pointerdown', closeOnOutside)
  }, [open])

  const matches = connection?.databases.filter((db) => db.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? []
  function select(db: string) {
    onDatabase?.(db)
    setOpen(false)
    picker.current?.focus()
  }

  return <header className="topbar">
    <div className="wordmark"><span className="brand-mark" aria-hidden="true"><img src={jujuba} alt="" /></span><strong>Jujuba<span>SQL</span></strong></div>
    <div className="header-divider" />
    {diagramActive ? <button className="button" onClick={onDiagrams}><Database size={15} />Bancos de dados</button> : <>
    {connection ? <button className="button header-connect" onClick={onDisconnect} disabled={disconnecting} title="Desconectar">
      <Power size={15} /><span>Desconectar</span></button> :
      <button className="button primary header-connect" onClick={onConnect} disabled={connecting}><Plug size={15} /><span>Conectar</span></button>}
    <div className="database-picker" ref={dropdown}
      onKeyDown={(event) => { if (event.key === 'Escape' && open) { setOpen(false); picker.current?.focus() } }}>
      <button ref={picker} className="button database-button" aria-expanded={open} disabled={!connection}
        onClick={() => { setSearch(''); setOpen(!open) }}><Database size={15} />
        <span>{database ?? 'Selecionar banco'}</span><ChevronDown size={14} /></button>
      {open && connection && <div className="db-popover">
        <label className="search-field"><Search size={16} /><input autoFocus aria-label="Buscar banco" placeholder="Buscar banco…"
          value={search} onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !matches[0]) return
            event.preventDefault()
            select(matches[0])
          }} /></label>
        <div className="db-options">{matches.map((db) => <button key={db} onClick={() => select(db)}>
          <Database size={15} /><span>{db}</span>{db === database && <Check size={14} />}</button>)}
          {!matches.length && <p>Nenhum banco encontrado.</p>}
        </div>
      </div>}
    </div>
    </>}
    {onDiagrams && <button className="button system-tab" aria-pressed={!!diagramActive}
      onClick={diagramActive ? undefined : onDiagrams}><GitBranch size={15} />Diagramas</button>}
    {tools}
    <div className="header-spacer" />
    <button className="icon-button theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label={theme === 'dark' ? 'Usar fundo branco' : 'Usar fundo preto'}
      title={theme === 'dark' ? 'Usar fundo branco' : 'Usar fundo preto'}>
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
    <UpdateButton />
    {!diagramActive && <span className={`connection-status${connection ? ' online' : ''}`}><i />{connection ? 'Conectado' : 'Desconectado'}</span>}
  </header>
}
