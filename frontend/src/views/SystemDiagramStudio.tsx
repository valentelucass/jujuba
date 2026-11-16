import { Braces, FileDown, FilePlus2, FolderOpen, GitBranch, LayoutGrid, LoaderCircle, Redo2, Save, Sparkles, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { appError, systemDiagram } from '../controllers/api'
import {
  emptyDiagram, type AiProvider, type DiagramProject, type GeneratedProject, type StagePosition,
  type SystemDiagram, type SystemEdge,
} from '../models/systemDiagram'
import { Header } from './Header'
import { StatusBar } from './StatusBar'
import { SystemFlowCanvas } from './SystemFlowCanvas'
import { SystemFlowEditor } from './SystemFlowEditor'

export function SystemDiagramStudio({ exit, provider, assistantDiagram, onDiagram }: {
  exit: () => void
  provider: AiProvider
  assistantDiagram: { diagram: SystemDiagram; revisionOf: SystemDiagram | null } | null
  onDiagram: (diagram: SystemDiagram | null) => void
}) {
  const [diagram, setDiagram] = useState<SystemDiagram | null>(null)
  const [history, setHistory] = useState<{ past: (SystemDiagram | null)[]; future: (SystemDiagram | null)[] }>({ past: [], future: [] })
  const [project, setProject] = useState<DiagramProject | null>(null)
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
  const appliedDiagram = useRef<typeof assistantDiagram>(null)

  useEffect(() => { onDiagram(diagram) }, [diagram, onDiagram])
  useEffect(() => {
    if (!assistantDiagram || appliedDiagram.current === assistantDiagram) return
    appliedDiagram.current = assistantDiagram
    replace(assistantDiagram.diagram, assistantDiagram.revisionOf === diagram ? project : null, true)
  }, [assistantDiagram, diagram, project])

  async function perform(label: string, operation: () => Promise<void>) {
    if (locking.current) return
    locking.current = true
    setBusy(label)
    setError('')
    setNotice('')
    try { await operation() }
    catch (failure) { setError(appError(failure).message) }
    finally { locking.current = false; setBusy('') }
  }

  function edit(next: SystemDiagram) {
    if (locking.current) return
    setHistory(({ past }) => ({ past: [...past.slice(-39), diagram], future: [] }))
    showEdit(next)
  }

  function showEdit(next: SystemDiagram | null) {
    setDiagram(next)
    setDirty(true)
    setCode(null)
    setNotice('')
  }

  function restore(direction: 'past' | 'future') {
    if (locking.current || !history[direction].length) return
    const { past, future } = history
    const next = history[direction].at(-1) ?? null
    setHistory(direction === 'past' ? { past: past.slice(0, -1), future: [...future, diagram] } :
      { past: [...past, diagram], future: future.slice(0, -1) })
    if (!next?.nodes.some((node) => node.id === selected)) setSelected(null)
    showEdit(next)
  }

  function organize() {
    if (!diagram) return
    edit({ ...diagram, nodes: diagram.nodes.map((node) => ({ ...node, position: undefined })) })
    setFitKey((value) => value + 1)
  }

  function replace(next: SystemDiagram, source: DiagramProject | null, modified: boolean) {
    setHistory({ past: [], future: [] })
    setDiagram(next)
    setProject(source)
    setSelected(null)
    setDirty(modified)
    setFitKey((value) => value + 1)
    setTab('flow')
    setCode(null)
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

  function confirmDiscard() {
    return !dirty || window.confirm('Descartar alterações ainda não salvas?')
  }

  function newDiagram() {
    if (!confirmDiscard()) return
    setError('')
    setNotice('')
    replace(emptyDiagram, null, false)
  }

  async function open() {
    if (!confirmDiscard()) return
    await perform('Abrindo fluxograma…', async () => {
      const opened = await systemDiagram.open()
      if (opened) {
        replace(opened.diagram, opened.project, false)
        setNotice('Fluxograma aberto.')
      }
    })
  }

  function save() {
    if (!diagram) return
    void perform('Salvando fluxograma…', async () => {
      const saved = await systemDiagram.save(diagram, project)
      if (saved) {
        setProject(saved)
        setDirty(false)
        setNotice('Fluxograma salvo.')
      }
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
    if (!project || dirty) return
    void perform('Gerando implementação…', async () => {
      const next = await systemDiagram.scaffold(provider, project, technology)
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

  return <>
    <Header onDiagrams={exit} diagramActive />
    <main className="system-design" aria-label="Fluxogramas de sistema">
      <header className="system-design-toolbar">
        <div className="system-doc">
          <h1><GitBranch size={19} />{diagram?.title || 'Fluxogramas de sistema'}</h1>
          {project ? <code title={project.path}>{project.path}</code> : <small>{diagram ? 'Fluxograma ainda sem arquivo' : 'Planeje o fluxo antes de implementar.'}</small>}
        </div>
        <div className="system-doc-actions">
          <button className="button" disabled={!!busy} onClick={newDiagram}><FilePlus2 size={15} />Novo</button>
          <button className="button" disabled={!!busy} onClick={() => void open()}><FolderOpen size={15} />Abrir</button>
          <button className="button design-accent" disabled={!diagram || !!busy} onClick={save}><Save size={15} />Salvar</button>
          <button className="button" disabled={!diagram || !!busy} onClick={exportMarkdown}><FileDown size={15} />Markdown</button>
        </div>
      </header>
      {(busy || error || notice) && <div className={'system-message' + (error ? ' is-error' : '')} role={error ? 'alert' : 'status'}>
        {busy && <LoaderCircle size={15} className="spin" />}{error || busy || notice}
      </div>}
      <div className="system-design-body">
        <SystemFlowCanvas key={fitKey} diagram={diagram} selected={selected}
          choose={(id) => { setSelected(id); if (id) setTab('flow') }} connect={addEdge}
          move={moveStep} disabled={!!busy} />
        <aside className="system-design-panel system-inspector">
          <div className="system-panel-tabs" aria-label="Detalhes do fluxograma">
            <button className="button" aria-pressed={tab === 'flow'} onClick={() => setTab('flow')}><GitBranch size={14} />Fluxo</button>
            <button className="button" aria-pressed={tab === 'code'} onClick={() => setTab('code')}><Braces size={14} />Código</button>
          </div>
          {tab === 'flow' ? <>
            <div className="flow-edit-actions" aria-label="Edição do fluxograma">
              <button className="icon-button" disabled={!!busy || !history.past.length}
                aria-label="Desfazer" title="Desfazer" onClick={() => restore('past')}><Undo2 size={16} /></button>
              <button className="icon-button" disabled={!!busy || !history.future.length}
                aria-label="Refazer" title="Refazer" onClick={() => restore('future')}><Redo2 size={16} /></button>
              <button className="button" disabled={!!busy || !diagram?.nodes.some((node) => node.position)}
                onClick={organize}><LayoutGrid size={15} />Organizar</button>
            </div>
            <SystemFlowEditor key={fitKey} diagram={diagram ?? emptyDiagram} selected={selected}
              select={setSelected} update={edit} addEdge={addEdge} disabled={!!busy} />
          </> :
            <fieldset className="system-form" disabled={!!busy}>
              {(!project || dirty) && <p className="system-hint">Salve o fluxograma antes de gerar a implementação.</p>}
              <label>Tecnologia e instruções<textarea value={technology} maxLength={4000} rows={4}
                placeholder="Ex. HTML, CSS e JavaScript, com validação e instruções de uso."
                onChange={(event) => setTechnology(event.target.value)} /></label>
              <button className="button design-accent" disabled={!project || dirty} onClick={scaffold}><Sparkles size={15} />Gerar implementação</button>
              {code && <><label>Arquivo<select value={fileIndex} onChange={(event) => setFileIndex(Number(event.target.value))}>
                {code.files.map((file, index) => <option key={file.path} value={index}>{file.path}</option>)}
              </select></label>
                <pre className="system-code-preview" tabIndex={0}>{code.files[fileIndex]?.content}</pre>
                <button className="button" onClick={saveCode}><Save size={15} />Salvar código em uma pasta</button>
              </>}
            </fieldset>}
        </aside>
      </div>
    </main>
    <StatusBar />
  </>
}
