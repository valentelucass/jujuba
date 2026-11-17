import { FolderOpen, LoaderCircle, Paperclip, Send, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import jujuba from '../assets/jujuba.png'
import { appError, systemDiagram } from '../controllers/api'
import type { AiProvider, ChatMessage, ReferenceDocument, SystemDiagram } from '../models/systemDiagram'

const assistants = {
  codex: { label: 'ChatGPT · Codex', login: 'Entre com sua conta do ChatGPT no Codex.' },
  claude: { label: 'Claude · Claude Code', login: 'Entre com sua conta no Claude Code.' },
  gemini: { label: 'Gemini · Gemini CLI', login: 'No Gemini CLI, escolha entrar com o Google.' },
} satisfies Record<AiProvider, { label: string; login: string }>

const preference = 'jujuba.assistant.provider'
const accepted = ['.txt', '.md', '.json', '.yaml', '.yml', '.csv', '.xml', '.mmd', '.mermaid']
const attachmentLimit = 64_000
const launcherPreference = 'jujuba.assistant.position'
const launcherSize = 66
const launcherMargin = 10

type Point = { x: number; y: number }

function readLauncherPosition(): Point | null {
  try {
    const point = JSON.parse(localStorage.getItem(launcherPreference) ?? 'null')
    if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) return point
  } catch { /* The launcher still works without browser storage. */ }
  return null
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight }
}

function clamp(value: number, max: number, min = launcherMargin) {
  return Math.max(min, Math.min(max, value))
}

type Turn = ChatMessage & { diagram?: SystemDiagram; revisionOf?: SystemDiagram | null }

export function readProvider(): AiProvider {
  try {
    const value = localStorage.getItem(preference)
    if (value === 'claude' || value === 'gemini') return value
  } catch { /* The assistant can still be selected in this session. */ }
  return 'codex'
}

export function AssistantDock({ open, setOpen, provider, setProvider, screen, diagram, onDiagram }: {
  open: boolean
  setOpen: (open: boolean) => void
  provider: AiProvider
  setProvider: (provider: AiProvider) => void
  screen: string
  diagram: SystemDiagram | null
  onDiagram: (diagram: SystemDiagram, revisionOf: SystemDiagram | null) => boolean
}) {
  const [workspace, setWorkspace] = useState('')
  const [attachments, setAttachments] = useState<ReferenceDocument[]>([])
  const [chat, setChat] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [screenSize, setScreenSize] = useState(viewport)
  const [placement, setPlacement] = useState(readLauncherPosition)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ id: number; origin: Point; offset: Point; moved: boolean } | null>(null)
  const moved = useRef(false)
  const lock = useRef(false)
  const composer = useRef<HTMLTextAreaElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const end = useRef<HTMLLIElement>(null)

  useEffect(() => { if (open) composer.current?.focus() }, [open])
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: 'nearest' }) }, [chat, busy, open])
  useEffect(() => {
    const resize = () => setScreenSize(viewport())
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const { width, height } = screenSize
  const endX = width - launcherSize - launcherMargin
  const endY = height - launcherSize - launcherMargin
  const point = {
    x: clamp(placement?.x ?? width - launcherSize - 18, endX),
    y: clamp(placement?.y ?? height - launcherSize - 40, endY),
  }
  const dockWidth = Math.min(415, width - 28)
  const dockHeight = Math.min(615, height - 28)
  const panel = {
    left: clamp(point.x + launcherSize - dockWidth, width - dockWidth - 14, 14),
    top: clamp(point.y - dockHeight - 8, height - dockHeight - 14, 14),
  }
  if (point.y < dockHeight + 22) {
    if (point.y + launcherSize + dockHeight + 22 <= height) panel.top = point.y + launcherSize + 8
    else if (point.x >= dockWidth + 22) panel.left = point.x - dockWidth - 8
    else if (point.x + launcherSize + dockWidth + 22 <= width) panel.left = point.x + launcherSize + 8
  }

  function place(next: Point, save = false) {
    const bounded = { x: clamp(next.x, endX), y: clamp(next.y, endY) }
    setPlacement(bounded)
    if (save) {
      try { localStorage.setItem(launcherPreference, JSON.stringify(bounded)) } catch { /* Placement remains active. */ }
    }
  }

  function grab(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary) return
    moved.current = false
    drag.current = {
      id: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      offset: { x: event.clientX - point.x, y: event.clientY - point.y },
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current
    if (!active || active.id !== event.pointerId) return
    if (!active.moved && Math.hypot(event.clientX - active.origin.x, event.clientY - active.origin.y) < 4) return
    active.moved = true
    setDragging(true)
    place({ x: event.clientX - active.offset.x, y: event.clientY - active.offset.y })
  }

  function release(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current
    if (!active || active.id !== event.pointerId) return
    drag.current = null
    setDragging(false)
    moved.current = active.moved
    if (active.moved) place(event.type === 'pointerup'
      ? { x: event.clientX - active.offset.x, y: event.clientY - active.offset.y }
      : point, true)
  }

  function close() {
    setOpen(false)
    launcher.current?.focus()
  }

  function chooseProvider(next: AiProvider) {
    setProvider(next)
    setNotice('')
    setError('')
    try { localStorage.setItem(preference, next) } catch { /* The current choice remains active. */ }
  }

  async function perform(label: string, work: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(label)
    setError('')
    setNotice('')
    try { await work() }
    catch (failure) { setError(appError(failure).message) }
    finally { lock.current = false; setBusy('') }
  }

  function chooseFolder() {
    void perform('Selecionando pasta…', async () => {
      const path = await systemDiagram.chooseWorkspace()
      if (path && path !== workspace) {
        setWorkspace(path)
        setChat([])
      }
    })
  }

  function check() {
    void perform('Verificando assistente…', async () => {
      await systemDiagram.checkAgent(provider)
      setNotice(provider === 'gemini' ? 'Gemini CLI instalado. Envie uma mensagem para testar a sessão.' : 'Assistente instalado e autenticado.')
    })
  }

  function attach(files: File[]) {
    if (!files.length) return
    void perform('Lendo documentação…', async () => {
      const size = new TextEncoder().encode(attachments.map(({ text }) => text).join('')).byteLength
      if (attachments.length + files.length > 4 || size + files.reduce((total, file) => total + file.size, 0) > attachmentLimit) {
        throw { kind: 'input', message: 'Anexe até quatro documentos, com 64 KB no total.' }
      }
      const next = await Promise.all(files.map(async (file) => {
        if (!accepted.some((suffix) => file.name.toLowerCase().endsWith(suffix))) {
          throw { kind: 'input', message: 'Use documentos de texto, como TXT, Markdown, JSON ou CSV.' }
        }
        const content = await file.arrayBuffer()
        try { return { name: file.name, text: new TextDecoder('utf-8', { fatal: true }).decode(content) } }
        catch { throw { kind: 'input', message: 'Salve o documento como texto UTF-8 para anexá-lo.' } }
      }))
      setAttachments([...attachments, ...next])
    })
  }

  function send() {
    const prompt = draft.trim()
    if (!prompt) return
    void perform('Assistente trabalhando…', async () => {
      const history = chat.slice(-12).map(({ role, content }) => ({ role, content: content.slice(0, 2500) }))
      const result = await systemDiagram.converse(provider, { prompt, screen, history, diagram, documents: attachments })
      setChat([...chat, { role: 'user', content: prompt }, {
        role: 'assistant', content: result.reply, diagram: result.diagram ?? undefined, revisionOf: diagram,
      }])
      setDraft('')
    })
  }

  return <>
    {open && <section id="assistant-dock" className="assistant-dock" aria-label="Assistente de IA" style={panel}
      onKeyDown={(event) => { if (event.key === 'Escape' && !event.defaultPrevented) close() }}>
      <header className="assistant-heading">
        <div><h2><Sparkles size={17} />Assistente de IA</h2><small>{screen}</small></div>
        <button className="icon-button" onClick={close} aria-label="Fechar assistente"><X size={17} /></button>
      </header>
      <div className="assistant-config">
        <label className="sr-only" htmlFor="assistant-provider">Assistente</label>
        <select id="assistant-provider" value={provider} disabled={!!busy} onChange={(event) => chooseProvider(event.target.value as AiProvider)}>
          {Object.entries(assistants).map(([key, assistant]) => <option key={key} value={key}>{assistant.label}</option>)}
        </select>
        <button className="icon-button" onClick={chooseFolder} disabled={!!busy}
          title="Escolher pasta do projeto" aria-label="Escolher pasta do projeto"><FolderOpen size={17} /></button>
        <button className="button assistant-connection" aria-expanded={verifyOpen} onClick={() => setVerifyOpen(!verifyOpen)}>Conexão</button>
      </div>
      {workspace && <small className="assistant-workspace" title={workspace}>{workspace}</small>}
      {verifyOpen && <div className="assistant-verification">
        <p>{assistants[provider].login} O assistente usa o contexto das mensagens e os documentos anexados.</p>
        {workspace && <p>Ao pedir alterações de código, o assistente pode ler e editar a pasta escolhida.</p>}
        <button className="button" disabled={!!busy} onClick={check}>Verificar assistente</button>
      </div>}
      <ol className="project-chat-history" aria-label="Conversa" aria-live="polite">
        {chat.length === 0 && <li className="assistant-empty">Peça um fluxograma, anexe documentação ou escolha uma pasta para trabalhar no código.</li>}
        {chat.map((turn, index) => <li key={index} className={turn.role}>
          <strong>{turn.role === 'user' ? 'Você' : assistants[provider].label}</strong>
          <p>{turn.content}</p>
          {turn.diagram && <button className="button design-accent" onClick={() => {
            if (turn.diagram && onDiagram(turn.diagram, turn.revisionOf ?? null)) close()
          }}>Abrir fluxograma no editor</button>}
        </li>)}
        <li className="assistant-scroll-anchor" aria-hidden="true" ref={end} />
      </ol>
      {(busy || error || notice) && <div className={'assistant-status' + (error ? ' is-error' : '')} role={error ? 'alert' : 'status'}>
        {busy && <LoaderCircle size={15} className="spin" />}{error || busy || notice}
      </div>}
      <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); send() }}>
        {attachments.length > 0 && <ul className="assistant-files" aria-label="Documentos anexados">
          {attachments.map(({ name }, index) => <li key={index}>
            <span title={name}>{name}</span>
            <button type="button" disabled={!!busy} onClick={() => setAttachments(attachments.filter((_, i) => i !== index))}
              aria-label={'Remover ' + name}><X size={12} /></button>
          </li>)}
        </ul>}
        <textarea ref={composer} rows={3} aria-label="Mensagem para o assistente" placeholder="Ex. Construa o fluxograma do cadastro"
          value={draft} maxLength={4000} disabled={!!busy} onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send() } }} />
        <div className="assistant-compose-actions">
          <label className="button assistant-attach" title="Anexar documentos de texto">
            <Paperclip size={15} />Anexar
            <input type="file" accept={accepted.join(',')} aria-label="Anexar documentos" multiple disabled={!!busy}
              onChange={(event) => { attach(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '' }} />
          </label>
          <button className="button primary" disabled={!draft.trim() || !!busy}><Send size={15} />Enviar</button>
        </div>
      </form>
    </section>}
    <button ref={launcher} className={'assistant-launch' + (dragging ? ' is-dragging' : '')}
      style={{ left: point.x, top: point.y }} aria-label={open ? 'Fechar assistente' : 'Abrir assistente de IA'}
      title="Assistente de IA · clique para abrir ou arraste para mover" aria-expanded={open} aria-controls={open ? 'assistant-dock' : undefined}
      onPointerDown={grab} onPointerMove={move} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
      onKeyDown={(event) => {
        const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
        const direction = directions[event.key]
        if (!direction) return
        event.preventDefault()
        place({ x: point.x + direction[0] * 12, y: point.y + direction[1] * 12 }, true)
      }}
      onClick={(event) => {
        if (event.detail && moved.current) return
        if (open) close()
        else setOpen(true)
      }}>
      <img src={jujuba} alt="" draggable={false} />
      <Sparkles className="assistant-launch-sparkle" size={22} aria-hidden="true" />
    </button>
  </>
}
