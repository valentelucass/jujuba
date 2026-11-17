
import { ArrowLeft, Braces, Copy, FileDown, FilePlus2, FolderOpen, GitBranch, LayoutGrid, Link, LoaderCircle, Redo2, Save, Sparkles, Trash2, Undo2, Users } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import type { MascotRoom } from '../models/flowMascot'
import type { Connection } from '../models/sql'
import { clearFlowUpgrade, rememberFlowUpgrade, type FlowUpgrade } from '../controllers/flowUpgrade'
import { FlowRoomVersion } from './FlowRoomVersion'
import { version as buildVersion } from '../../package.json'
import { appError, flowCollaboration, flowProjects, systemDiagram } from '../controllers/api'
import type { FlowCommand, FlowProject, FlowProjectEntry, FlowSession } from '../models/flowWorkspace'
import {
  emptyDiagram, type AiProvider, type AssistantFlowChange, type DiagramProject, type GeneratedProject, type StagePosition,
  type SystemDiagram, type SystemEdge,
} from '../models/systemDiagram'
import { Header } from './Header'
import { FlowOverview } from './FlowOverview'
import { FlowProjectPreview } from './FlowProjectPreview'
import { SidebarDivider } from './SidebarDivider'
import { StatusBar } from './StatusBar'
import { SystemFlowCanvas } from './SystemFlowCanvas'
import { SystemFlowEditor } from './SystemFlowEditor'

type History = { past: SystemDiagram[]; future: SystemDiagram[] }
type SavedFlowAccess = { code: string; title: string; host: string; name: string }
const inspectorKey = 'jujuba.flow.inspector.width'
const inspectorMinimum = 236
const inspectorDefault = 318

const savedAccessKey = 'jujuba.flow.access'

function readSavedAccess(): SavedFlowAccess[] {
  try {
    return JSON.parse(localStorage.getItem(savedAccessKey) || '[]')
  } catch {
    return []
  }
}

function hasElement(diagram: SystemDiagram, id: string | null) {
  return diagram.nodes.some((node) => node.id === id) || diagram.notes?.some((note) => note.id === id)
}

type Panel = 'create' | 'share' | 'join' | null

export function SystemDiagramStudio({ exit, provider, assistantDiagram, onDiagram, onMascotRoom, connection, upgrade }: {
  exit: () => void
  connection?: Connection | null
  upgrade: FlowUpgrade | null
  provider: AiProvider
  assistantDiagram: AssistantFlowChange | null
  onDiagram: (diagram: SystemDiagram | null) => void
  onMascotRoom: (room: MascotRoom | null) => void
}) {
  const [entries, setEntries] = useState<FlowProjectEntry[]>([])
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [session, setSession] = useState<FlowSession | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [invite, setInvite] = useState('')
  const [remember, setRemember] = useState(false)
  const [savedAccess, setSavedAccess] = useState(readSavedAccess)
  const guestName = useRef('')
  const attemptedJoin = useRef<{ code: string; name: string } | null>(null)
  const resumedUpgrade = useRef(false)
  const savedTicket = useRef<string | null>(null)
  const [inspectorSizing, setInspectorSizing] = useState(false)
  const [inspectorLimit, setInspectorLimit] = useState(() => Math.max(inspectorMinimum, Math.min(640, Math.floor(window.innerWidth * .54))))
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try {
      const width = Number(localStorage.getItem(inspectorKey))
      return width >= inspectorMinimum && Number.isFinite(width) ? width : inspectorDefault
    } catch {
      return inspectorDefault
    }
  })
  const panelWidth = Math.min(inspectorLimit, inspectorWidth)
  const [diagram, setDiagram] = useState<SystemDiagram | null>(null)
  const [history, setHistory] = useState<History>({ past: [], future: [] })
  const [file, setFile] = useState<DiagramProject | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [fitKey, setFitKey] = useState(0)
  const [code, setCode] = useState<GeneratedProject | null>(null)
  const [fileIndex, setFileIndex] = useState(0)
  const [technology, setTechnology] = useState('')
  const [tab, setTab] = useState<'flow' | 'code'>('flow')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const locking = useRef(false)
  const active = useRef<FlowSession | null>(null)
  const queuedCursor = useRef<{ id: string; position: StagePosition | null } | null>(null)
  const sendingCursor = useRef(false)
  const edits = useRef(Promise.resolve())
  const editGeneration = useRef(0)
  const pendingEdits = useRef(0)
  const diagramRef = useRef<SystemDiagram | null>(null)
  const appliedDiagram = useRef<typeof assistantDiagram>(null)
  const sessionId = session?.id
  const guest = !!session && session.projectId === null
  const disabled = !!busy || (!!session && !session.canEdit && (guest || session.phase !== 'ended'))

  useEffect(() => {
    if (!upgrade || resumedUpgrade.current) return
    resumedUpgrade.current = true
    clearFlowUpgrade()
    void perform('Voltando ao fluxograma…', async () => {
      if (upgrade.kind === 'join') setActive(await joinProject(upgrade.code, upgrade.name))
      else await openWorkspace(await flowProjects.load(upgrade.project), upgrade.resumeInvite)
    })
  }, [upgrade])

  useEffect(() => { onDiagram(diagram) }, [diagram, onDiagram])

  useEffect(() => {
    if (!sessionId || session?.phase !== 'connected' || !session.peer || !session.mascotSupported) {
      onMascotRoom(null)
    } else {
      onMascotRoom({ id: sessionId, peer: session.peer, host: session.projectId !== null, rich: !!session.peerVersion,
        mascot: session.mascot ?? null, meeting: session.mascotMeeting ?? null, splats: session.mascotSplats ?? [] })
    }
  }, [sessionId, session?.phase, session?.peer, session?.peerVersion, session?.mascotSupported, session?.mascotVersion, onMascotRoom])

  useEffect(() => {
    function resize() {
      setInspectorLimit(Math.max(inspectorMinimum, Math.min(640, Math.floor(window.innerWidth * .54))))
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    if (workspace || sessionId) return
    let disposed = false
    flowProjects.list().then(
      (projects) => { if (!disposed) setEntries(projects) },
      (failure) => { if (!disposed) setError(appError(failure).message) },
    )
    return () => { disposed = true }
  }, [workspace, sessionId])

  useEffect(() => () => {
    if (active.current) void flowCollaboration.end(active.current.id).catch(() => {})
  }, [])

  useEffect(() => {
    if (!sessionId) return
    const id = sessionId
    let seen = 0
    let known: number | undefined
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const generation = editGeneration.current
        const view = await flowCollaboration.view(id, seen, known)
        if (disposed || active.current?.id !== id) return
        if (!view) {
          setError('A sessão de compartilhamento foi encerrada.')
          setActive(null)
          return
        }
        if ('unchanged' in view) {
          timer = setTimeout(() => void refresh(), 0)
          return
        }
        known = view.liveVersion
        if (view.phase === 'approval' && active.current.phase !== 'approval') setRemember(false)
        active.current = view
        setSession(view)
        if (view.diagram && pendingEdits.current === 0 && generation === editGeneration.current) {
          if (seen === 0 && view.projectId === null) {
            replace(view.diagram, null, false)
            if (view.returnCode && view.peer && view.returnCode !== savedTicket.current) {
              saveGuestAccess({ code: view.returnCode, title: view.diagram.title, host: view.peer, name: guestName.current })
              savedTicket.current = view.returnCode
            }
          } else if (JSON.stringify(diagramRef.current) !== JSON.stringify(view.diagram)) {
            setHistory({ past: [], future: [] })
            setCurrentDiagram(view.diagram)
            setSelected((id) => view.diagram && hasElement(view.diagram, id) ? id : null)
            setDirty(true)
            setCode(null)
          }
          seen = view.revision
        }
        if (view.phase !== 'ended') {
          const delay = seen !== view.revision ? 16 : view.liveVersion === undefined ? 100 : 0
          timer = setTimeout(() => void refresh(), delay)
        }
      } catch (failure) {
        if (!disposed && active.current?.id === id) {
          setError(appError(failure).message)
          timer = setTimeout(() => void refresh(), 500)
        }
      }
    }
    void refresh()
    return () => { disposed = true; clearTimeout(timer) }
  }, [sessionId])

  useEffect(() => {
    if (!assistantDiagram || appliedDiagram.current === assistantDiagram) return
    appliedDiagram.current = assistantDiagram
    const { diagram: next, revisionOf, createNew, complete } = assistantDiagram
    if (disabled || locking.current) {
      complete({ applied: false, message: 'O editor está ocupado. Aguarde a operação atual e envie o pedido novamente.' })
      return
    }
    if (!createNew && revisionOf !== diagramRef.current) {
      complete({ applied: false, message: 'O projeto mudou durante a resposta. Envie o pedido novamente para usar a versão atual.' })
      return
    }
    if (!createNew && diagram) {
      const saved = edit(next)
      if (!saved) {
        complete({ applied: false, message: 'O projeto está indisponível para edição.' })
        return
      }
      if (!hasElement(next, selected)) setSelected(null)
      setFitKey((value) => value + 1)
      void saved.then(
        () => complete({ applied: true, message: 'Alterações aplicadas neste projeto.' }),
        (error) => complete({ applied: false, message: appError(error).message }),
      )
    } else {
      void perform('Criando projeto…', async () => {
        try {
          await openWorkspace(await flowProjects.create({ ...next, title: next.title.trim() || emptyDiagram.title }, null))
          complete({ applied: true, message: 'Novo fluxograma aberto no editor.' })
        } catch (error) {
          complete({ applied: false, message: appError(error).message })
          throw error
        }
      })
    }
  }, [assistantDiagram, diagram, disabled])

  async function perform(label: string, operation: () => Promise<void>) {
    if (locking.current) return
    locking.current = true
    setBusy(label)
    setError('')
    setNotice('')
    try {
      await edits.current
      await operation()
    } catch (failure) {
      setError(appError(failure).message)
    } finally {
      locking.current = false
      setBusy('')
    }
  }

  function setActive(view: FlowSession | null) {
    active.current = view
    setSession(view)
  }

  async function endSession() {
    const current = active.current
    if (!current) return
    await flowCollaboration.end(current.id)
    setActive(null)
  }

  function persist(before: SystemDiagram, next: SystemDiagram) {
    const current = active.current?.phase === 'ended' ? null : active.current
    editGeneration.current += 1
    pendingEdits.current += 1
    const id = workspace
    const saved = edits.current.then(async () => {
      if (current) {
        await flowCollaboration.command(current.id, { type: 'edit', before, diagram: next })
      } else if (id) {
        await flowProjects.edit(id, next)
      }
    }).finally(() => { pendingEdits.current -= 1 })
    edits.current = saved.catch((failure) => setError(appError(failure).message))
    return saved
  }

  function edit(next: SystemDiagram) {
    if (locking.current || disabled || !diagram) return
    setHistory(({ past }) => ({ past: [...past.slice(-39), diagram], future: [] }))
    return showEdit(diagram, next)
  }

  function setCurrentDiagram(next: SystemDiagram | null) {
    diagramRef.current = next
    setDiagram(next)
  }

  function showEdit(before: SystemDiagram, next: SystemDiagram) {
    setCurrentDiagram(next)
    setDirty(true)
    setCode(null)
    setNotice('')
    return persist(before, next)
  }

  function restore(direction: 'past' | 'future') {
    if (locking.current || disabled || !diagram) return
    const { past, future } = history
    const next = history[direction].at(-1)
    if (!next) return
    setHistory(direction === 'past' ? { past: past.slice(0, -1), future: [...future, diagram] } :
      { past: [...past, diagram], future: future.slice(0, -1) })
    if (!hasElement(next, selected)) setSelected(null)
    showEdit(diagram, next)
  }

  function organize() {
    if (!diagram) return
    edit({ ...diagram, nodes: diagram.nodes.map((node) => ({ ...node, position: undefined })) })
    setFitKey((value) => value + 1)
  }

  function replace(next: SystemDiagram | null, source: DiagramProject | null, modified: boolean) {
    setHistory({ past: [], future: [] })
    setCurrentDiagram(next)
    setExportOpen(false)
    setFile(source)
    setSelected(null)
    setDirty(modified)
    setFitKey((value) => value + 1)
    setTab('flow')
    setCode(null)
  }

  async function openWorkspace(next: FlowProject, resumeInvite = false) {
    setWorkspace(next.id)
    setPanel(null)
    replace(next.diagram, next.file, next.fileDirty)
    if (next.returningGuest || resumeInvite) setActive(await flowCollaboration.host(next.id, undefined, resumeInvite))
  }

  function addEdge(edge: SystemEdge) {
    if (!diagram || diagram.edges.length >= 48 || diagram.edges.some((entry) =>
      entry.from === edge.from && entry.to === edge.to && entry.label === edge.label)) return
    edit({ ...diagram, edges: [...diagram.edges, edge] })
  }

  function moveStep(id: string, position: StagePosition) {
    if (!diagram) return
    if (diagram.notes?.some((note) => note.id === id)) {
      edit({ ...diagram, notes: diagram.notes.map((note) => note.id === id ? { ...note, position } : note) })
    } else {
      edit({ ...diagram, nodes: diagram.nodes.map((node) => node.id === id ? { ...node, position } : node) })
    }
  }

  function renameStep(id: string, label: string) {
    if (!diagram) return
    if (diagram.notes?.some((note) => note.id === id)) {
      edit({ ...diagram, notes: diagram.notes.map((note) => note.id === id ? { ...note, text: label } : note) })
    } else {
      edit({ ...diagram, nodes: diagram.nodes.map((node) => node.id === id ? { ...node, label } : node) })
    }
  }

  function library() {
    void perform('Abrindo projetos…', async () => {
      await endSession()
      setWorkspace(null)
      setPanel(null)
      replace(null, null, false)
    })
  }

  function create(event: FormEvent) {
    event.preventDefault()
    void perform('Criando projeto…', async () => {
      await openWorkspace(await flowProjects.create({ ...emptyDiagram, title: title.trim() }, null))
      setTitle('')
    })
  }

  function importDiagram() {
    void perform('Importando fluxograma…', async () => {
      const opened = await systemDiagram.open()
      if (opened) await openWorkspace(await flowProjects.create(opened.diagram, opened.project))
    })
  }

  function remove(entry: FlowProjectEntry) {
    if (!window.confirm('Excluir o projeto “' + (entry.title || 'Sem título') + '” de Meus projetos?')) return
    void perform('Excluindo projeto…', async () => {
      await flowProjects.remove(entry.id)
      setEntries((list) => list.filter((project) => project.id !== entry.id))
    })
  }

  function openSession(event: FormEvent) {
    event.preventDefault()
    void perform('Iniciando conexão…', async () => {
      const view = panel === 'share' && workspace
        ? await flowCollaboration.host(workspace, name)
        : await joinProject(invite, name)
      setActive(view)
      setPanel(null)
      setInvite('')
    })
  }

  function saveGuestAccess(access: SavedFlowAccess) {
    // The first 42 characters identify the host endpoint, independently of the ticket.
    const next = [access, ...readSavedAccess().filter((entry) => entry.code.slice(0, 42) !== access.code.slice(0, 42))]
    localStorage.setItem(savedAccessKey, JSON.stringify(next))
    setSavedAccess(next)
  }

  function forgetAccess(code: string) {
    const next = readSavedAccess().filter((entry) => entry.code !== code)
    localStorage.setItem(savedAccessKey, JSON.stringify(next))
    setSavedAccess(next)
  }

  function joinProject(code: string, name: string) {
    guestName.current = name.trim()
    attemptedJoin.current = { code: code.trim(), name: guestName.current }
    savedTicket.current = null
    return flowCollaboration.join(code, name)
  }

  async function prepareFlowUpdate() {
    await edits.current
    const current = active.current
    if (!current) return
    if (workspace) {
      rememberFlowUpgrade({ kind: 'host', project: workspace, resumeInvite: current.phase === 'approval' || current.phase === 'inviting' })
      return clearFlowUpgrade
    } else if (attemptedJoin.current) {
      const code = current.returnCode ?? (current.phase === 'connected' ? null : attemptedJoin.current.code)
      if (code) {
        rememberFlowUpgrade({ kind: 'join', code, name: attemptedJoin.current.name })
        return clearFlowUpgrade
      }
    }
  }

  function retryEntry() {
    const attempt = attemptedJoin.current
    if (attempt) void perform('Tentando entrar novamente…', async () => {
      await endSession()
      if (!workspace) replace(null, null, false)
      setActive(await joinProject(attempt.code, attempt.name))
    })
  }

  function returnToProject(access: SavedFlowAccess) {
    void perform('Abrindo projeto compartilhado…', async () => {
      setActive(await joinProject(access.code, access.name))
      setPanel(null)
    })
  }

  function sessionCommand(command: FlowCommand, label: string) {
    const id = active.current?.id
    if (id) void perform(label, () => flowCollaboration.command(id, command))
  }

  function closeSharing() {
    void perform('Encerrando conexão…', async () => {
      await endSession()
      setPanel(null)
      if (guest) replace(null, null, false)
    })
  }

  function leaveStudio() {
    if (!active.current) {
      exit()
      return
    }
    void perform('Fechando projeto…', async () => {
      await endSession()
      setWorkspace(null)
      setPanel(null)
      replace(null, null, false)
      exit()
    })
  }

  async function sendCursor(position: StagePosition | null) {
    const current = active.current
    if (current?.phase !== 'connected') return
    queuedCursor.current = { id: current.id, position }
    if (sendingCursor.current) return
    sendingCursor.current = true
    try {
      while (queuedCursor.current) {
        const next = queuedCursor.current
        queuedCursor.current = null
        if (active.current?.id !== next.id || active.current.phase !== 'connected') continue
        await flowCollaboration.command(next.id, { type: 'cursor', position: next.position }).catch(() => {})
      }
    } finally {
      sendingCursor.current = false
    }
  }

  function save() {
    if (!diagram) return
    void perform('Salvando arquivo…', async () => {
      const saved = await systemDiagram.save(diagram, file)
      if (!saved) return
      if (workspace) {
        await flowProjects.link(workspace, saved, diagram)
        const savedWorkspace = await flowProjects.load(workspace)
        setDirty(savedWorkspace.fileDirty)
      } else {
        setDirty(false)
      }
      setFile(saved)
      setNotice('Arquivo salvo.')
    })
  }

  function saveCopy() {
    if (!diagram) return
    void perform('Salvando cópia…', async () => {
      await flowProjects.create(diagram, null)
      setNotice('Cópia salva em Meus projetos.')
    })
  }

  function exportDiagram(format: 'png' | 'markdown') {
    setExportOpen(false)
    if (!diagram) return
    void perform('Exportando fluxograma…', async () => {
      let path
      if (format === 'png') {
        const { flowImage } = await import('../models/flowImage')
        path = await systemDiagram.png(await flowImage(diagram))
      } else {
        path = await systemDiagram.markdown(diagram)
      }
      if (path) setNotice('Fluxograma exportado em ' + path)
    })
  }

  function scaffold() {
    if (!file || dirty) return
    void perform('Gerando implementação…', async () => {
      const next = await systemDiagram.scaffold(provider, file, technology)
      setCode(next)
      setFileIndex(0)
      setNotice('Confira os arquivos gerados antes de salvar.')
    })
  }

  function saveCode() {
    if (!code) return
    void perform('Salvando arquivos…', async () => {
      const directory = await systemDiagram.writeCode(code)
      if (directory) setNotice('Implementação salva em ' + directory)
    })
  }

  const hasProject = workspace !== null || diagram !== null

  return <>
    <Header onDiagrams={leaveStudio} diagramActive />
    <main className="system-design" aria-label="Fluxogramas de sistema">
      <header className="system-design-toolbar">
        <div className="system-doc">
          <h1><GitBranch size={19} />{hasProject ? diagram?.title || 'Projeto sem título' : 'Meus projetos'}</h1>
          {file && <code title={file.path}>{file.path}</code>}
        </div>
        {session?.phase === 'connected' && <div className="flow-share-presence" aria-label="Compartilhamento do fluxograma">
          <Users size={17} />
          <span><strong>{session.peer}</strong> está no fluxograma{session.peerVersion === buildVersion && <> · v{session.peerVersion}</>}</span>
        </div>}
        <div className="system-doc-actions">
          {session?.phase === 'connected' && <>
            {!guest && session.trustedPeer && <button className="button" disabled={!!busy}
              onClick={() => sessionCommand({ type: 'revoke' }, 'Revogando acesso…')}>Revogar acesso salvo</button>}
            <button className="button" disabled={!!busy} onClick={closeSharing}>
              {guest ? 'Sair da sessão' : 'Encerrar sessão'}
            </button>
          </>}
          {hasProject ? <>
            <button className="icon-button" disabled={!!busy} onClick={library}
              aria-label="Voltar para Meus projetos" title="Voltar para Meus projetos"><ArrowLeft size={17} /></button>
            {workspace && (!session || session.phase === 'available') && <button className="button design-accent" disabled={!!busy}
              onClick={() => setPanel(panel === 'share' ? null : 'share')}><Users size={15} />Compartilhar</button>}
            {guest ? <button className="icon-button" disabled={!!busy} onClick={saveCopy}
              aria-label="Salvar cópia" title="Salvar cópia"><Copy size={17} /></button> : null}
            <button className="icon-button" disabled={!diagram || !!busy} onClick={save}
              aria-label="Salvar arquivo" title="Salvar arquivo"><Save size={17} /></button>
            <div className="flow-export" onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setExportOpen(false)
            }} onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setExportOpen(false)
                event.currentTarget.querySelector('button')?.focus()
              }
            }}>
              <button className="icon-button" disabled={!diagram || !!busy} aria-expanded={exportOpen}
                onClick={() => setExportOpen((open) => !open)} aria-label="Exportar fluxograma"
                title="Exportar fluxograma"><FileDown size={17} /></button>
              {exportOpen && <div className="flow-export-options" aria-label="Formato de exportação">
                <button type="button" className="button" onClick={() => exportDiagram('png')}>Imagem PNG</button>
                <button type="button" className="button" onClick={() => exportDiagram('markdown')}>Markdown</button>
              </div>}
            </div>
          </> : <>
            <button className="button design-accent" disabled={!!busy || !!session}
              onClick={() => setPanel(panel === 'create' ? null : 'create')}><FilePlus2 size={15} />Novo projeto</button>
            <button className="button" disabled={!!busy || !!session}
              onClick={importDiagram} title="Importar um projeto .jujuba.json"><FolderOpen size={15} />Importar</button>
            <button className="button" disabled={!!busy || !!session}
              onClick={() => setPanel(panel === 'join' ? null : 'join')}><Link size={15} />Entrar por código</button>
          </>}
        </div>
      </header>
      {panel === 'create' && <form className="flow-share-bar" onSubmit={create}>
        <label>Nome do projeto <input autoFocus maxLength={60} value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
        <button className="button design-accent" disabled={!!busy || !title.trim()}>Criar projeto</button>
        <button type="button" className="button" disabled={!!busy} onClick={() => setPanel(null)}>Cancelar</button>
      </form>}
      {((panel === 'share' && !session) || panel === 'join') && <form className="flow-share-bar" onSubmit={openSession}>
        <label>Seu nome <input autoFocus maxLength={32} value={name} onChange={(event) => setName(event.target.value)} required /></label>
        {panel === 'join' && <label>Código do convite <input className="flow-invite-code"
          value={invite} onChange={(event) => setInvite(event.target.value)} spellCheck={false} autoComplete="off" required /></label>}
        <button className="button design-accent" disabled={!!busy || !name.trim() || (panel === 'join' && !invite.trim())}>
          {panel === 'share' ? 'Gerar convite' : 'Pedir para entrar'}
        </button>
        <button type="button" className="button" disabled={!!busy} onClick={() => setPanel(null)}>Cancelar</button>
      </form>}
      {session && session.phase !== 'connected' && (session.phase !== 'available' || panel === 'share') && <div className="flow-share-bar" aria-label="Compartilhamento do fluxograma">
        <Users size={17} />
        {session.phase === 'starting' && <span role="status">Estabelecendo conexão…</span>}
        {session.phase === 'available' && <>
          {session.trustedPeer && <span><strong>{session.trustedPeer}</strong> tem acesso salvo</span>}
          <button className="button design-accent" disabled={!!busy}
            onClick={() => { setPanel(null); sessionCommand({ type: 'invite' }, 'Gerando convite…') }}>Gerar convite</button>
          {session.trustedPeer && <button className="button" disabled={!!busy}
            onClick={() => sessionCommand({ type: 'revoke' }, 'Revogando acesso…')}>Revogar acesso salvo</button>}
        </>}
        {session.phase === 'joining' && <span role="status">{session.peer ? <>Aguardando a aprovação de <strong>{session.peer}</strong>…</> : 'Aguardando aprovação do dono do projeto…'}</span>}
        {(session.phase === 'approval' || (session.phase === 'joining' && session.peerVersion)) &&
          <FlowRoomVersion peerVersion={session.peerVersion} prepare={prepareFlowUpdate} disabled={!!busy} />}
        {session.code && <><label>Código do convite
          <input className="flow-invite-code" readOnly value={session.code} onFocus={(event) => event.target.select()} />
        </label>
          <button className="button" disabled={!!busy} onClick={() => {
            if (session.code) void navigator.clipboard.writeText(session.code).then(
              () => setNotice('Código copiado.'), () => setNotice('Selecione o código para copiar.'),
            )
          }}><Copy size={15} />Copiar código</button>
          <small>Válido por 10 min</small>
        </>}
        {session.phase === 'approval' && <>
          <span role="status"><strong>{session.peer}</strong> quer entrar neste projeto.</span>
          <label>
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            Permitir que volte enquanto este projeto estiver aberto
          </label>
          {remember && session.trustedPeer && session.trustedPeer !== session.peer &&
            <small>Substitui o acesso salvo de {session.trustedPeer}.</small>}
          <button className="button design-accent" disabled={!!busy}
            onClick={() => sessionCommand({ type: 'accept', remember }, 'Aceitando pedido…')}>Aceitar</button>
          <button className="button" disabled={!!busy}
            onClick={() => sessionCommand({ type: 'reject' }, 'Recusando pedido…')}>Recusar</button>
        </>}
        {session.phase === 'ended' && <span role="status">{session.message}</span>}
        {session.phase === 'ended' && guest && attemptedJoin.current && <button className="button"
          disabled={!!busy} onClick={retryEntry}>Tentar entrar novamente</button>}
        <button className="button flow-end-share" disabled={!!busy} onClick={closeSharing}>
          {session.phase === 'ended' ? 'Fechar sessão' : guest ? 'Cancelar entrada' : 'Encerrar sessão'}
        </button>
      </div>}
      {session?.phase === 'connected' && session.peerVersion !== buildVersion &&
        <div className="flow-share-bar"><FlowRoomVersion peerVersion={session.peerVersion}
          prepare={prepareFlowUpdate} disabled={!!busy} /></div>}
      {(busy || error || notice || (session?.phase === 'connected' && session.message)) && <div className={'system-message' + (error ? ' is-error' : '')} role={error ? 'alert' : 'status'}>
        {busy && <LoaderCircle size={15} className="spin" />}{error || busy || notice || session?.message}
      </div>}
      {diagram && <FlowOverview key={fitKey} diagram={diagram} />}
      {!hasProject ? <section className="flow-project-library" aria-label="Projetos de fluxograma">
        {entries.length ? <ul>
          {entries.map((entry) => <li key={entry.id}>
            <button className="flow-open-project" disabled={!!busy || !!session}
              onClick={() => void perform('Abrindo projeto…', async () => openWorkspace(await flowProjects.load(entry.id)))}>
              <span className="flow-card-preview"><FlowProjectPreview preview={entry.preview} /></span>
              <span className="flow-card-title"><GitBranch size={15} />{entry.title || 'Projeto sem título'}</span>
            </button>
            <button className="icon-button" disabled={!!busy || !!session} aria-label={'Excluir ' + (entry.title || 'projeto sem título')}
              onClick={() => remove(entry)}><Trash2 size={15} /></button>
          </li>)}
        </ul> : !savedAccess.length && <p>Crie ou importe um fluxograma para começar.</p>}
        {!!savedAccess.length && <section className="flow-return-projects" aria-label="Acessos salvos">
          <h2>Acessos salvos</h2>
          <ul>{savedAccess.map((access) => <li key={access.code}>
            <button className="flow-open-project" disabled={!!busy || !!session} onClick={() => returnToProject(access)}>
              <span className="flow-card-preview"><div className="flow-saved-preview"><Users size={30} /><span>{access.host}</span></div></span>
              <span className="flow-card-title"><GitBranch size={15} />{access.title || 'Projeto sem título'}</span>
            </button>
            <button className="icon-button" disabled={!!busy || !!session} aria-label={'Esquecer acesso a ' + access.title}
              title="Esquecer acesso" onClick={() => forgetAccess(access.code)}><Trash2 size={15} /></button>
          </li>)}</ul>
        </section>}
      </section> : <div className={'system-design-body' + (inspectorSizing ? ' resizing' : '')}
        style={{ '--flow-inspector-width': panelWidth + 'px' } as CSSProperties}>
        <SystemFlowCanvas key={fitKey} diagram={diagram} selected={selected}
          choose={(id) => { setSelected(id); if (id) setTab('flow') }} connect={addEdge}
          move={moveStep} rename={renameStep} disabled={disabled} sendCursor={session?.phase === 'connected' ? sendCursor : undefined}
          peerCursor={session?.cursor && session.peer ? { ...session.cursor, name: session.peer } : null} />
        <SidebarDivider side="right" width={panelWidth} minimum={inspectorMinimum} maximum={inspectorLimit}
          defaultWidth={inspectorDefault} label="Largura do painel de fluxograma" controls="flow-inspector"
          onDrag={setInspectorSizing} onWidth={(next, settled) => {
            setInspectorWidth(next)
            if (settled) {
              try { localStorage.setItem(inspectorKey, String(next)) } catch { /* A largura atual continua ativa. */ }
            }
          }} />
        <aside id="flow-inspector" className="system-design-panel system-inspector">
          <div className="system-panel-tabs" aria-label="Detalhes do fluxograma">
            <button className="button" aria-pressed={tab === 'flow'} onClick={() => setTab('flow')}><GitBranch size={14} />Fluxo</button>
            <button className="button" aria-pressed={tab === 'code'} onClick={() => setTab('code')}><Braces size={14} />Código</button>
          </div>
          {tab === 'flow' ? <>
            <div className="flow-edit-actions" aria-label="Edição do fluxograma">
              <button className="icon-button" disabled={disabled || !history.past.length}
                aria-label="Desfazer" title="Desfazer" onClick={() => restore('past')}><Undo2 size={16} /></button>
              <button className="icon-button" disabled={disabled || !history.future.length}
                aria-label="Refazer" title="Refazer" onClick={() => restore('future')}><Redo2 size={16} /></button>
              <button className="button" disabled={disabled || !diagram?.nodes.some((node) => node.position)}
                onClick={organize}><LayoutGrid size={15} />Organizar</button>
            </div>
            <SystemFlowEditor key={fitKey} diagram={diagram ?? emptyDiagram} selected={selected}
              select={setSelected} update={edit} addEdge={addEdge} disabled={disabled} />
          </> :
            <fieldset className="system-form" disabled={!!busy}>
              {(!file || dirty) && <p className="system-hint">Salve o arquivo do fluxograma antes de gerar a implementação.</p>}
              <label>Tecnologia e instruções<textarea value={technology} maxLength={4000} rows={4}
                placeholder="Ex. HTML, CSS e JavaScript, com validação e instruções de uso."
                onChange={(event) => setTechnology(event.target.value)} /></label>
              <button className="button design-accent" disabled={!file || dirty} onClick={scaffold}><Sparkles size={15} />Gerar implementação</button>
              {code && <><label>Arquivo<select value={fileIndex} onChange={(event) => setFileIndex(Number(event.target.value))}>
                {code.files.map((file, index) => <option key={file.path} value={index}>{file.path}</option>)}
              </select></label>
                <pre className="system-code-preview" tabIndex={0}>{code.files[fileIndex]?.content}</pre>
                <button className="button" onClick={saveCode}><Save size={15} />Salvar código em uma pasta</button>
              </>}
            </fieldset>}
        </aside>
      </div>}
    </main>
    <StatusBar engine={connection?.engine} endpoint={connection?.endpoint} />
  </>
}
