import { FolderOpen, LoaderCircle, Paperclip, Send, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { JujubaMascot } from './JujubaMascot'
import { hats, MascotHat, readHat, saveHat, type Hat } from './MascotHat'
import { appError, systemDiagram } from '../controllers/api'
import { animateThrow, verticalFlick, type FlightFrame, type ImpactEdge } from '../controllers/mascotMotion'
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
const launcherMargin = 20
const sideGesture = 24

type Point = { x: number; y: number }
type LauncherPosition = { side: 'left' | 'right'; y: number }
type Reaction = 'protesting' | 'scared' | 'relieved'
type Splat = Point & { id: number; edge: ImpactEdge; strength: number }

function readLauncherPosition(): LauncherPosition | null {
  try {
    const point = JSON.parse(localStorage.getItem(launcherPreference) ?? 'null')
    if (!Number.isFinite(point?.y)) return null
    if (point.side === 'left' || point.side === 'right') return point
    if (Number.isFinite(point.x)) {
      return { side: edgeAt(point.x, window.innerWidth), y: point.y }
    }
  } catch { /* The launcher still works without browser storage. */ }
  return null
}

function viewport() {
  const root = document.getElementById('root')
  const styles = root && getComputedStyle(root)
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    header: Number.parseFloat(styles?.getPropertyValue('--app-header-height') ?? '') || 0,
    footer: Number.parseFloat(styles?.getPropertyValue('--app-footer-height') ?? '') || 0,
  }
}

function clamp(value: number, max: number, min = launcherMargin) {
  return Math.max(min, Math.min(max, value))
}

function edgeAt(x: number, width: number) {
  return x + launcherSize / 2 < width / 2 ? 'left' : 'right'
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
  const [hat, setHat] = useState(readHat)
  const [hatsOpen, setHatsOpen] = useState(false)
  const [grabbed, setGrabbed] = useState(false)
  const [reaction, setReaction] = useState<Reaction | null>(null)
  const [dragPoint, setDragPoint] = useState<Point | null>(null)
  const [flight, setFlight] = useState<FlightFrame | null>(null)
  const [splats, setSplats] = useState<Splat[]>([])
  const drag = useRef<{ id: number; origin: Point; offset: Point; moved: boolean; samples: (Point & { time: number })[] } | null>(null)
  const cancelFlight = useRef<(() => void) | null>(null)
  const nextSplat = useRef(0)
  const recall = useRef<{ armed: boolean } | null>(null)
  const lastPointer = useRef<Point | null>(null)
  const moved = useRef(false)
  const lock = useRef(false)
  const composer = useRef<HTMLTextAreaElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const end = useRef<HTMLLIElement>(null)

  useEffect(() => { if (open) composer.current?.focus() }, [open])
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: 'nearest' }) }, [chat, busy, open])
  useEffect(() => {
    if (!reaction) return
    const timer = window.setTimeout(() => setReaction(null), reaction === 'scared' ? 850 : 650)
    return () => window.clearTimeout(timer)
  }, [reaction])
  useEffect(() => {
    const resize = () => setScreenSize(viewport())
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    function approach(event: globalThis.PointerEvent) {
      if (event.pointerType === 'touch') return
      lastPointer.current = { x: event.clientX, y: event.clientY }
      if (!recall.current || cancelFlight.current || drag.current || !launcher.current) return
      const rect = launcher.current.getBoundingClientRect()
      const distance = Math.hypot(event.clientX - rect.x - rect.width / 2, event.clientY - rect.y - rect.height / 2)
      if (distance > 110) recall.current.armed = true
      if (distance < 82 && recall.current.armed) {
        recall.current = null
        setReaction('scared')
      }
    }
    window.addEventListener('pointermove', approach, { passive: true })
    return () => {
      window.removeEventListener('pointermove', approach)
      cancelFlight.current?.()
    }
  }, [])

  const { width, height, header, footer } = screenSize
  const side = placement?.side ?? 'right'
  const endX = width - launcherSize - launcherMargin
  const startY = header + launcherMargin
  const endY = Math.max(startY, height - footer - launcherSize - 6)
  const floorY = Math.max(startY, height - footer - launcherSize + 5)
  const resting = {
    x: side === 'left' ? launcherMargin : endX,
    y: clamp(placement?.y ?? endY, endY, startY),
  }
  const point = dragPoint ?? (flight ? { x: resting.x, y: clamp(flight.y, floorY, startY) } : resting)
  const dockAnchor = flight ? resting : point
  const dockWidth = Math.min(415, width - 28)
  const dockHeight = Math.min(615, height - 28)
  const panel = {
    left: clamp(dockAnchor.x + launcherSize - dockWidth, width - dockWidth - 14, 14),
    top: clamp(dockAnchor.y - dockHeight - 8, height - dockHeight - 14, 14),
  }
  if (dockAnchor.y < dockHeight + 22) {
    if (dockAnchor.y + launcherSize + dockHeight + 22 <= height) panel.top = dockAnchor.y + launcherSize + 8
    else if (dockAnchor.x >= dockWidth + 22) panel.left = dockAnchor.x - dockWidth - 8
    else if (dockAnchor.x + launcherSize + dockWidth + 22 <= width) panel.left = dockAnchor.x + launcherSize + 8
  }

  function place(side: LauncherPosition['side'], y: number) {
    const next = { side, y: clamp(y, endY, startY) }
    setPlacement(next)
    try { localStorage.setItem(launcherPreference, JSON.stringify(next)) } catch { /* Placement remains active. */ }
  }

  function grab(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary) return
    if (cancelFlight.current) {
      cancelFlight.current()
      cancelFlight.current = null
      place(side, point.y)
      setFlight(null)
    }
    moved.current = false
    drag.current = {
      id: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      offset: { x: event.clientX - point.x, y: event.clientY - point.y },
      moved: false,
      samples: [{ x: event.clientX, y: event.clientY, time: event.timeStamp }],
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setReaction(null)
    setGrabbed(true)
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current
    if (!active || active.id !== event.pointerId) return
    active.samples.push({ x: event.clientX, y: event.clientY, time: event.timeStamp })
    if (active.samples.length > 20) active.samples.shift()
    if (!active.moved && Math.hypot(event.clientX - active.origin.x, event.clientY - active.origin.y) < 4) return
    active.moved = true
    setDragPoint({
      x: clamp(event.clientX - active.offset.x, endX),
      y: clamp(event.clientY - active.offset.y, endY, startY),
    })
  }

  function release(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current
    if (!active || active.id !== event.pointerId) return
    drag.current = null
    setGrabbed(false)
    setDragPoint(null)
    moved.current = active.moved
    if (!active.moved || event.type !== 'pointerup') return
    const shiftX = event.clientX - active.origin.x
    const shiftY = event.clientY - active.origin.y
    const other = side === 'left' ? 'right' : 'left'
    const inward = side === 'left' ? shiftX : -shiftX
    const sideChange = inward >= Math.max(sideGesture, Math.abs(shiftY) / 3)
      || edgeAt(event.clientX - active.offset.x, width) !== side
    const y = event.clientY - active.offset.y
    lastPointer.current = { x: event.clientX, y: event.clientY }
    const velocity = verticalFlick(active.samples, { x: event.clientX, y: event.clientY, time: event.timeStamp })
    if (velocity && floorY - startY > 72 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      throwMascot(y, velocity)
      return
    }
    place(sideChange ? other : side, y)
    if (sideChange) {
      const x = (other === 'left' ? launcherMargin : endX) + launcherSize / 2
      setSplats((previous) => previous.filter((mark) => Math.hypot(mark.x - x, mark.y - clamp(y, endY, startY)) > 86))
    }
    setReaction(sideChange ? 'relieved' : 'protesting')
  }

  function throwMascot(y: number, velocity: number) {
    const center = resting.x + launcherSize / 2
    const from = clamp(y, floorY, startY)
    recall.current = null
    setFlight({ y: from, squash: 0, edge: velocity < 0 ? 'top' : 'bottom' })
    cancelFlight.current = animateThrow(from, velocity, startY, floorY, setFlight, (edge, strength) => {
      const mark = {
        id: ++nextSplat.current, edge, strength, x: center,
        y: edge === 'top' ? startY + 12 : height - footer - 2,
      }
      setSplats((previous) => [...previous.slice(-8), mark])
    }, (end, hit) => {
      cancelFlight.current = null
      setFlight(null)
      place(side, end)
      const pointer = lastPointer.current
      if (hit && pointer) {
        const landing = clamp(end, endY, startY) + launcherSize / 2
        recall.current = { armed: Math.hypot(pointer.x - center, pointer.y - landing) > 110 }
      }
    })
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
        <div className="assistant-heading-actions">
          <button className="button" type="button" aria-expanded={hatsOpen} aria-controls={hatsOpen ? 'assistant-hats' : undefined}
            onClick={() => setHatsOpen(!hatsOpen)}>Chapéus</button>
          <button className="icon-button" onClick={close} aria-label="Fechar assistente"><X size={17} /></button>
        </div>
      </header>
      {hatsOpen && <div id="assistant-hats" className="assistant-hats" role="group" aria-label="Chapéus da Jujuba">
        {(Object.keys(hats) as Hat[]).map((option) => <button key={option} className="button" type="button"
          aria-pressed={hat === option} onClick={() => { setHat(option); saveHat(option) }}>
          {option === 'none' ? <span className="hat-miniature" aria-hidden="true">—</span> : <MascotHat hat={option} miniature />}
          {hats[option]}
        </button>)}
      </div>}
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
    {splats.map((mark) => <svg key={mark.id} className={`jujuba-splat is-${mark.edge}`} aria-hidden="true" viewBox="0 0 104 48"
      style={{ left: mark.x, top: mark.y, width: 53 + mark.strength * 36 }}
      onAnimationEnd={() => setSplats((previous) => previous.filter((entry) => entry.id !== mark.id))}>
      <path d="M9 39c1-5 13-2 21-7s23-5 31-1 13 2 21 4 16 1 15 6c-2 6-17 1-26 2-14 0-27 4-40 1s-23 2-22-5z" fill="#e73898" />
      <path d="M25 36q11 2 23-1t25 3" fill="none" stroke="#ff9ace" strokeWidth="3" strokeLinecap="round" />
      <path d="M8 23c-4-4-1-6 2-4s6 8 3 8-4-2-5-4zm74-4c4-5 8-4 7-1s-8 9-10 7 1-4 3-6Z" fill="#fb70b7" />
      <circle cx="34" cy="15" r="2.4" fill="#ed5da6" /><circle cx="71" cy="7" r="3" fill="#f478b9" />
    </svg>)}
    <button ref={launcher} className={`assistant-launch${grabbed ? ' is-grabbed' : ''}${dragPoint ? ' is-dragging' : ''}${flight ? ' is-flying' : ''}${reaction ? ' is-' + reaction : ''}`}
      style={{ left: point.x, top: point.y }} aria-label={open ? 'Fechar assistente' : 'Abrir assistente de IA'}
      title="Assistente de IA · arraste na vertical ou deslize para trocar de borda" aria-expanded={open} aria-controls={open ? 'assistant-dock' : undefined}
      onPointerDown={grab} onPointerMove={move} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
      onKeyDown={(event) => {
        const locations: Record<string, LauncherPosition> = {
          ArrowLeft: { side: 'left', y: point.y }, ArrowRight: { side: 'right', y: point.y },
          ArrowUp: { side, y: point.y - 12 }, ArrowDown: { side, y: point.y + 12 },
        }
        const next = locations[event.key]
        if (next) {
          event.preventDefault()
          if (cancelFlight.current) return
          place(next.side, next.y)
        }
      }}
      onClick={(event) => {
        if (event.detail && moved.current) return
        if (open) close()
        else setOpen(true)
      }}>
      <JujubaMascot followPointer grabbed={grabbed} reaction={reaction} flight={flight} hat={hat} />
    </button>
  </>
}
