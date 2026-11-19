import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Activity, Braces, ChartNoAxesCombined, Check, ChevronDown, Database, Gauge, GitBranch, GitFork, Moon, Plug, Power, Search, Sun } from 'lucide-react'
import jujuba from '../assets/jujuba.png'
import './header.css'
import type { Connection, Database as DatabaseName } from '../models/sql'
import { useTheme } from './Theme'

const bankTools = [
  { id: 'diagram', label: 'Diagrama do banco', hint: 'Veja as tabelas e suas relações.', icon: GitFork },
  { id: 'dashboard', label: 'Dashboards', hint: 'Acompanhe os indicadores do banco.', icon: ChartNoAxesCombined },
  { id: 'monitor', label: 'Monitor do banco', hint: 'Veja o uso de memória, as aplicações e a atividade do banco selecionado.', icon: Gauge },
  { id: 'sql', label: 'SQL', hint: 'Abra o editor de consultas.', icon: Braces },
] as const

type BankTool = (typeof bankTools)[number]['id']

export type StudioArea = 'database' | 'diagrams' | 'pm2'
export const StudioNavigation = createContext<{ area: StudioArea; go: (area: StudioArea) => void } | null>(null)

export function HeaderAction({ label, hint, active, unavailable, onClick, children }: {
  label: string; hint: string; active?: boolean; unavailable?: boolean; onClick?: () => void; children: ReactNode
}) {
  const id = useId()
  const [dismissed, setDismissed] = useState(false)
  const reveal = (element: HTMLElement) => {
    setDismissed(false)
    const box = element.getBoundingClientRect()
    const center = Math.max(100, Math.min(window.innerWidth - 100, box.left + box.width / 2))
    element.style.setProperty('--tip-center', `${center - box.left}px`)
  }
  return <span className="toolbar-item" data-dismissed={dismissed || undefined}
    onPointerEnter={event => reveal(event.currentTarget)} onFocus={event => reveal(event.currentTarget)}
    onKeyDown={event => { if (event.key === 'Escape') setDismissed(true) }}>
    <button className="toolbar-icon" type="button" aria-label={label} aria-describedby={id} aria-pressed={active}
      aria-disabled={unavailable || undefined} onClick={unavailable ? undefined : onClick}>{children}</button>
    <span className="toolbar-tip" role="tooltip" id={id}><strong>{label}</strong>{hint}</span>
  </span>
}

export function DatabaseTools({ active, actions = {} }: {
  active?: BankTool
  actions?: Partial<Record<BankTool, () => void>>
}) {
  return <>{bankTools.map(({ id, label, hint, icon: Icon }) => <HeaderAction key={id} label={label}
    hint={actions[id] ? hint : 'Disponível ao selecionar um banco compatível.'}
    active={active === id} unavailable={!actions[id]} onClick={actions[id]}><Icon /></HeaderAction>)}</>
}

export function Header({ connection, database, onConnect, onDisconnect, onDatabase, tools, disconnecting, connecting }: {
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
  const navigation = useContext(StudioNavigation)
  const inDatabase = !navigation || navigation.area === 'database'
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
    <div className="wordmark" role="img" aria-label="JUJUBA"><img src={jujuba} alt="" /><strong aria-hidden="true">JUJU<span>BA</span></strong></div>
    {navigation && <nav className="studio-areas" aria-label="Áreas do JUJUBA">
      <HeaderAction label="Bancos de dados" hint="Explore conexões, tabelas e consultas." active={inDatabase}
        onClick={() => navigation.go('database')}><Database /></HeaderAction>
      <HeaderAction label="Fluxogramas" hint="Desenhe fluxos e colabore em projetos." active={navigation.area === 'diagrams'}
        onClick={() => navigation.go('diagrams')}><GitBranch /></HeaderAction>
      <HeaderAction label="PM2" hint="Acompanhe e gerencie os processos deste computador." active={navigation.area === 'pm2'}
        onClick={() => navigation.go('pm2')}><Activity /></HeaderAction>
    </nav>}
    {inDatabase && <div className="connection-tools">
      {connection ? <HeaderAction label="Desconectar" hint="Encerre a conexão com o banco atual." onClick={onDisconnect} unavailable={disconnecting}><Power /></HeaderAction> :
        <HeaderAction label="Conectar" hint="Escolha um banco para abrir uma conexão." onClick={onConnect} unavailable={connecting}><Plug /></HeaderAction>}
      <div className="database-picker" ref={dropdown}
        onKeyDown={(event) => { if (event.key === 'Escape' && open) { setOpen(false); picker.current?.focus() } }}>
        <button ref={picker} className="button database-button" aria-expanded={open} disabled={!connection} title="Escolher o banco da conexão"
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
    </div>}
    {inDatabase && <nav className="bank-tools" aria-label="Ferramentas do banco">{tools ?? <DatabaseTools />}</nav>}
    <div className="header-spacer" />
    <HeaderAction label={theme === 'dark' ? 'Usar fundo branco' : 'Usar fundo preto'} hint="Alterne a aparência do aplicativo."
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun /> : <Moon />}</HeaderAction>
  </header>
}
