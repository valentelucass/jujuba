
import { ArrowLeft, Braces, Copy, FileDown, FilePlus2, FolderOpen, GitBranch, LayoutGrid, Link, LoaderCircle, Redo2, Save, Sparkles, Trash2, Undo2, Users } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Connection } from '../models/sql'
import { appError, flowCollaboration, flowProjects, systemDiagram } from '../controllers/api'
import type { FlowCommand, FlowProject, FlowProjectEntry, FlowSession } from '../models/flowWorkspace'
import {
  emptyDiagram, type AiProvider, type DiagramProject, type GeneratedProject, type StagePosition,
  type SystemDiagram, type SystemEdge,
} from '../models/systemDiagram'
import { Header } from './Header'
import { StatusBar } from './StatusBar'
import { SystemFlowCanvas } from './SystemFlowCanvas'
import { SystemFlowEditor } from './SystemFlowEditor'

type History = { past: SystemDiagram[]; future: SystemDiagram[] }
type Panel = 'create' | 'share' | 'join' | null

export function SystemDiagramStudio({ exit, provider, assistantDiagram, onDiagram, connection }: {
  exit: () => void
  connection?: Connection | null
  provider: AiProvider
  assistantDiagram: { diagram: SystemDiagram; revisionOf: SystemDiagram | null } | null
  onDiagram: (diagram: SystemDiagram | null) => void
}) {
  const [entries, setEntries] = useState<FlowProjectEntry[]>([])
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [session, setSession] = useState<FlowSession | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [invite, setInvite] = useState('')
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
  const edits = useRef(Promise.resolve())
  const appliedDiagram = useRef<typeof assistantDiagram>(null)
  const sessionId = session?.id
  const guest = !!session && session.projectId === null
  const disabled = !!busy || (!!session && !session.canEdit)

  useEffect(() => { onDiagram(diagram) }, [diagram, onDiagram])

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
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const view = await flowCollaboration.view(id, seen)
        if (disposed || active.current?.id !== id) return
        if (!view) {
          setError('A sessão de compartilhamento foi encerrada.')
          setActive(null)
          return
        }
        active.current = view
        setSession(view)
        if (view.diagram) {
          if (seen === 0 && view.projectId === null) {
            replace(view.diagram, null, false)
          } else {
            setHistory({ past: [], future: [] })
            setDiagram(view.diagram)
            setSelected((id) => view.diagram?.nodes.some((node) => node.id === id) ? id : null)
            setDirty(true)
            setCode(null)
          }
          seen = view.revision
        }
        if (view.phase !== 'ended') timer = setTimeout(() => void refresh(), 100)
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
    if (disabled) {
      setError('Assuma a edição do projeto antes de aplicar o fluxograma do assistente.')
      return
    }
    if (diagram) {
      if (assistantDiagram.revisionOf && assistantDiagram.revisionOf !== diagram) {
        setError('O fluxograma mudou enquanto o assistente trabalhava. Envie o pedido novamente.')
        return
      }
      edit(assistantDiagram.diagram)
      setFitKey((value) => value + 1)
    } else {
      void perform('Criando projeto…', async () => {
        const next = assistantDiagram.diagram
        openWorkspace(await flowProjects.create({ ...next, title: next.title.trim() || emptyDiagram.title }, null))
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

  function persist(next: SystemDiagram) {
    const current = active.current
    const id = workspace
    edits.current = edits.current.then(async () => {
      if (current) {
        await flowCollaboration.command(current.id, { type: 'edit', diagram: next })
      } else if (id) {
        await flowProjects.edit(id, next)
      }
    }).catch((failure) => setError(appError(failure).message))
  }

  function edit(next: SystemDiagram) {
    if (locking.current || disabled || !diagram) return
    setHistory(({ past }) => ({ past: [...past.slice(-39), diagram], future: [] }))
    showEdit(next)
  }

  function showEdit(next: SystemDiagram) {
    setDiagram(next)
    setDirty(true)
    setCode(null)
    setNotice('')
    persist(next)
  }

  function restore(direction: 'past' | 'future') {
    if (locking.current || disabled || !diagram) return
    const { past, future } = history
    const next = history[direction].at(-1)
    if (!next) return
    setHistory(direction === 'past' ? { past: past.slice(0, -1), future: [...future, diagram] } :
      { past: [...past, diagram], future: future.slice(0, -1) })
    if (!next.nodes.some((node) => node.id === selected)) setSelected(null)
    showEdit(next)
  }

  function organize() {
    if (!diagram) return
    edit({ ...diagram, nodes: diagram.nodes.map((node) => ({ ...node, position: undefined })) })
    setFitKey((value) => value + 1)
  }

  function replace(next: SystemDiagram | null, source: DiagramProject | null, modified: boolean) {
    setHistory({ past: [], future: [] })
    setDiagram(next)
    setFile(source)
    setSelected(null)
    setDirty(modified)
    setFitKey((value) => value + 1)
    setTab('flow')
    setCode(null)
  }

  function openWorkspace(next: FlowProject) {
    setWorkspace(next.id)
    setPanel(null)
    replace(next.diagram, next.file, next.fileDirty)
  }

  function addEdge(edge: SystemEdge) {
    if (!diagram || diagram.edges.length >= 48 || diagram.edges.some((entry) =>
      entry.from === edge.from && entry.to === edge.to && entry.label === edge.label)) return
    edit({ ...diagram, edges: [...diagram.edges, edge] })
  }

  function moveStep(id: string, position: StagePosition) {
    if (!diagram) return
    edit({ ...diagram, nodes: diagram.nodes.map((node) => node.id === id ? { ...node, position } : node) })
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
      openWorkspace(await flowProjects.create({ ...emptyDiagram, title: title.trim() }, null))
      setTitle('')
    })
  }

  function importDiagram() {
    void perform('Importando fluxograma…', async () => {
      const opened = await systemDiagram.open()
      if (opened) openWorkspace(await flowProjects.create(opened.diagram, opened.project))
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
        : await flowCollaboration.join(invite, name)
      setActive(view)
      setPanel(null)
      setInvite('')
    })
  }

  function sessionCommand(type: 'accept' | 'reject' | 'passEdit') {
    const id = active.current?.id
    if (!id) return
    void perform(type === 'passEdit' ? 'Transferindo edição…' : 'Respondendo ao pedido…', async () => {
      await flowCollaboration.command(id, { type })
      if (type === 'passEdit' && active.current?.id === id) {
        const next = await flowCollaboration.view(id, active.current.revision)
        if (next && active.current?.id === id) setActive(next)
      }
    })
  }

  function sendCursor(position: StagePosition | null) {
    const current = active.current
    if (current?.phase === 'connected') {
      const command: FlowCommand = { type: 'cursor', position }
      void flowCollaboration.command(current.id, command).catch(() => {})
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

  function exportMarkdown() {
    if (!diagram) return
    void perform('Exportando Markdown…', async () => {
      const path = await systemDiagram.markdown(diagram)
      if (path) setNotice('Markdown exportado em ' + path)
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
    <Header onDiagrams={exit} diagramActive />
    <main className="system-design" aria-label="Fluxogramas de sistema">
      <header className="system-design-toolbar">
        <div className="system-doc">
          <h1><GitBranch size={19} />{hasProject ? diagram?.title || 'Projeto sem título' : 'Meus projetos'}</h1>
          {file && <code title={file.path}>{file.path}</code>}
        </div>
        <div className="system-doc-actions">
          {hasProject ? <>
            <button className="button" disabled={!!busy} onClick={library}><ArrowLeft size={15} />Meus projetos</button>
            {workspace && !session && <button className="button design-accent" disabled={!!busy}
              onClick={() => setPanel(panel === 'share' ? null : 'share')}><Users size={15} />Compartilhar</button>}
            {guest ? <button className="button" disabled={!!busy} onClick={saveCopy}><Copy size={15} />Salvar cópia</button>
              : <button className="button" disabled={!diagram || !!busy} onClick={save}><Save size={15} />Salvar arquivo</button>}
            <button className="button" disabled={!diagram || !!busy} onClick={exportMarkdown}><FileDown size={15} />Markdown</button>
          </> : <>
            <button className="button design-accent" disabled={!!busy || !!session}
              onClick={() => setPanel(panel === 'create' ? null : 'create')}><FilePlus2 size={15} />Novo projeto</button>
            <button className="button" disabled={!!busy || !!session}
              onClick={importDiagram}><FolderOpen size={15} />Importar</button>
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
      {(panel === 'share' || panel === 'join') && <form className="flow-share-bar" onSubmit={openSession}>
        <label>Seu nome <input autoFocus maxLength={32} value={name} onChange={(event) => setName(event.target.value)} required /></label>
        {panel === 'join' && <label>Código do convite <input className="flow-invite-code"
          value={invite} onChange={(event) => setInvite(event.target.value)} spellCheck={false} autoComplete="off" required /></label>}
        <button className="button design-accent" disabled={!!busy || !name.trim() || (panel === 'join' && !invite.trim())}>
          {panel === 'share' ? 'Gerar convite' : 'Pedir para entrar'}
        </button>
        <button type="button" className="button" disabled={!!busy} onClick={() => setPanel(null)}>Cancelar</button>
      </form>}
      {session && <div className="flow-share-bar" aria-label="Compartilhamento do fluxograma">
        <Users size={17} />
        {session.phase === 'starting' && <span role="status">Estabelecendo conexão…</span>}
        {session.phase === 'joining' && <span role="status">Aguardando aprovação do dono do projeto…</span>}
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
          <button className="button design-accent" disabled={!!busy} onClick={() => sessionCommand('accept')}>Aceitar</button>
          <button className="button" disabled={!!busy} onClick={() => sessionCommand('reject')}>Recusar</button>
        </>}
        {session.phase === 'connected' && <>
          <span><strong>{session.peer}</strong> está no fluxograma</span>
          {session.canEdit
            ? <button className="button" disabled={!!busy} onClick={() => sessionCommand('passEdit')}>Passar edição</button>
            : <small>Editando · {session.peer}</small>}
        </>}
        {session.phase === 'ended' && <span role="status">{session.message}</span>}
        <button className="button flow-end-share" disabled={!!busy} onClick={() => {
          if (guest && !diagram) library()
          else void perform('Encerrando conexão…', async () => {
            await endSession()
            if (guest) replace(null, null, false)
          })
        }}>{session.phase === 'ended' ? 'Fechar sessão' : 'Encerrar sessão'}</button>
      </div>}
      {(busy || error || notice) && <div className={'system-message' + (error ? ' is-error' : '')} role={error ? 'alert' : 'status'}>
        {busy && <LoaderCircle size={15} className="spin" />}{error || busy || notice}
      </div>}
      {!hasProject ? <section className="flow-project-library" aria-label="Projetos de fluxograma">
        {entries.length ? <ul>
          {entries.map((entry) => <li key={entry.id}>
            <button className="flow-open-project" disabled={!!busy || !!session}
              onClick={() => void perform('Abrindo projeto…', async () => openWorkspace(await flowProjects.load(entry.id)))}>
              <GitBranch size={18} />{entry.title || 'Projeto sem título'}
            </button>
            <button className="icon-button" disabled={!!busy || !!session} aria-label={'Excluir ' + (entry.title || 'projeto sem título')}
              onClick={() => remove(entry)}><Trash2 size={15} /></button>
          </li>)}
        </ul> : <p>Crie ou importe um fluxograma para começar.</p>}
      </section> : <div className="system-design-body">
        <SystemFlowCanvas key={fitKey} diagram={diagram} selected={selected}
          choose={(id) => { setSelected(id); if (id) setTab('flow') }} connect={addEdge}
          move={moveStep} disabled={disabled} sendCursor={session?.phase === 'connected' ? sendCursor : undefined}
          peerCursor={session?.cursor && session.peer ? { ...session.cursor, name: session.peer } : null} />
        <aside className="system-design-panel system-inspector">
          <div className="system-panel-tabs" aria-label="Detalhes do fluxograma">
            <button className="button" aria-pressed={tab === 'flow'} onClick={() => setTab('flow')}><GitBranch size={14} />Fluxo</button>
            {!guest && <button className="button" aria-pressed={tab === 'code'} onClick={() => setTab('code')}><Braces size={14} />Código</button>}
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
