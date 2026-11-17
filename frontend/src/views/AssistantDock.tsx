import { Copy, Eye, EyeOff, FolderOpen, LoaderCircle, Paperclip, Play, Send, Sparkles, Volume2, VolumeX, Wrench, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { JujubaMascot } from './JujubaMascot'
import { MascotMeetingEffect, MascotYoung, SharedMascot } from './SharedMascot'
import { useSharedMascot } from '../controllers/useSharedMascot'
import { useMascotClone } from '../controllers/useMascotClone'
import { useMascotScene } from '../controllers/useMascotScene'
import { useRemoteMascotCollisions } from '../controllers/useRemoteMascotCollisions'
import type { MascotScene } from '../models/mascotScene'
import { SharedMascotScene } from './SharedMascotScene'
import { useEggSchedule, useMascotBrood, type BroodActor } from '../controllers/useMascotBrood'
import type { ShotTarget } from '../controllers/mascotProjectile'
import { useMascotSound } from '../controllers/mascotSound'
import type { MascotImpulse, MascotPose, MascotRoom, MascotVisibility } from '../models/flowMascot'
import { MascotAim, MascotToyIcon, toyLabels, type MascotTool } from './MascotAim'
import { makeSplat, MascotSplat, type Splat } from './MascotSplat'
import { hats, MascotHat, readHat, saveHat, type Hat } from './MascotHat'
import { appError, systemDiagram } from '../controllers/api'
import { animateThrow, throwVelocity, type FlightBounds, type FlightFrame, type Impact, type Point, type PointerSample } from '../controllers/mascotMotion'
import type { AiProvider, AssistantFlowResult, ChatMessage, ReferenceDocument, SystemDiagram } from '../models/systemDiagram'

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

type Side = 'left' | 'right'
type LauncherPosition = { side: Side; y: number } | { side: 'bottom'; ratio: number }
type Reaction = 'protesting' | 'relieved'
type Trail = Point & { id: number; angle: number; strength: number; width: number }

function pointerDistance(pointer: Point, position: Point) {
  return Math.hypot(pointer.x - position.x - launcherSize / 2, pointer.y - position.y - launcherSize / 2)
}

function pointBetween(from: Point, toward?: Point | null) {
  if (!toward) return { x: 1, y: 0 }
  const x = toward.x - from.x
  const y = toward.y - from.y
  const length = Math.hypot(x, y)
  return length > .001 ? { x: x / length, y: y / length } : { x: 1, y: 0 }
}

function center(point: Point) {
  return { x: point.x + launcherSize / 2, y: point.y + launcherSize / 2 }
}

function readLauncherPosition(): LauncherPosition | null {
  try {
    const point = JSON.parse(localStorage.getItem(launcherPreference) ?? 'null')
    if (point?.side === 'bottom' && Number.isFinite(point.ratio)) return { side: 'bottom', ratio: clamp(point.ratio, 1, 0) }
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

type Turn = ChatMessage & { change?: AssistantFlowResult }

export function readProvider(): AiProvider {
  try {
    const value = localStorage.getItem(preference)
    if (value === 'claude' || value === 'gemini') return value
  } catch { /* The assistant can still be selected in this session. */ }
  return 'codex'
}

export function AssistantDock({ open, setOpen, provider, setProvider, screen, diagram, onDiagram, mascotRoom }: {
  open: boolean
  setOpen: (open: boolean) => void
  provider: AiProvider
  setProvider: (provider: AiProvider) => void
  screen: string
  diagram: SystemDiagram | null
  mascotRoom: MascotRoom | null
  onDiagram: (diagram: SystemDiagram, revisionOf: SystemDiagram | null, screen: string) => Promise<AssistantFlowResult>
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
  const [mascotOptions, setMascotOptions] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [tool, setTool] = useState<MascotTool | null>(null)
  const { settings: sound, save: saveSound, play: playSound, tension } = useMascotSound()
  const [grabbed, setGrabbed] = useState(false)
  const [reaction, setReaction] = useState<Reaction | null>(null)
  const [dragPoint, setDragPoint] = useState<Point | null>(null)
  const [frightened, setFrightened] = useState(false)
  const [pointerNear, setPointerNear] = useState(false)
  const [trail, setTrail] = useState<Trail[]>([])
  const [flight, setFlight] = useState<FlightFrame | null>(null)
  const [collisionRest, setCollisionRest] = useState<Point | null>(null)
  const [splats, setSplats] = useState<Splat[]>([])
  const outgoingScene = useRef<(() => MascotScene) | null>(null)
  const drag = useRef<{ id: number; origin: Point; offset: Point; moved: boolean; samples: PointerSample[] } | null>(null)
  const cancelFlight = useRef<(() => void) | null>(null)
  const nextSplat = useRef(0)
  const lastPointer = useRef<Point | null>(null)
  const moved = useRef(false)
  const lock = useRef(false)
  const dock = useRef<HTMLElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const end = useRef<HTMLLIElement>(null)

  useEffect(() => { if (open) composer.current?.focus() }, [open])
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: 'nearest' }) }, [chat, busy, open])
  useEffect(() => {
    if (!open) return
    function dismissOutside(event: MouseEvent) {
      const target = event.target
      if (target instanceof Node && !dock.current?.contains(target) && !launcher.current?.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('click', dismissOutside, true)
    return () => document.removeEventListener('click', dismissOutside, true)
  }, [open, setOpen])
  useEffect(() => {
    if (!reaction) return
    const timer = window.setTimeout(() => setReaction(null), 650)
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
      if (!frightened || cancelFlight.current || drag.current || !launcher.current) return
      const { x, y } = launcher.current.getBoundingClientRect()
      const distance = pointerDistance(lastPointer.current, { x, y })
      setPointerNear((near) => distance < (near ? 112 : 87))
    }
    window.addEventListener('pointermove', approach, { passive: true })
    return () => window.removeEventListener('pointermove', approach)
  }, [frightened])
  useEffect(() => () => cancelFlight.current?.(), [])

  const { width, height, header, footer } = screenSize
  const endX = Math.max(launcherMargin, width - launcherSize - launcherMargin)
  const startY = header + launcherMargin
  const endY = Math.max(startY, height - footer - launcherSize - 6)
  const floor = Math.max(startY, height - footer - launcherSize)
  const bounds: FlightBounds = { left: 6, top: header + 5, right: Math.max(6, width - launcherSize - 6), bottom: floor }
  const brood = useMascotBrood({ left: 22, top: header + 22, right: Math.max(22, width - 22), bottom: floor + 39 },
    (mark) => {
      const strength = .35 + mark.strength * .5
      playSound('bounceOffWall', strength)
      scene.shareSound('bounceOffWall', strength)
    })
  const boundsRef = useRef(bounds)
  boundsRef.current = bounds
  const resting = placement?.side === 'bottom'
    ? { x: bounds.left + placement.ratio * (bounds.right - bounds.left), y: floor }
    : { x: placement?.side === 'left' ? launcherMargin : endX, y: clamp(placement?.y ?? endY, endY, startY) }
  const side = placement?.side === 'bottom' ? edgeAt(resting.x, width) : placement?.side ?? 'right'
  const point = dragPoint ?? flight ?? collisionRest ?? resting
  const expression = grabbed ? null : frightened && !flight ? (pointerNear ? 'scared' : 'wary') : reaction
  const pose: MascotPose = grabbed ? 'held' : expression === 'scared' || expression === 'wary' ? expression : 'idle'
  const pairing = { position: point, bounds, hat, flight, pose, kick: collide, relocate: relocateMascot }
  const clone = useMascotClone(bounds, (impact) => {
    playSound('bounceOffWall', .64 + impact.strength * .7)
    scene.shareSound('bounceOffWall', .64 + impact.strength * .7)
    const mark = makeSplat(impact, launcherSize, ++nextSplat.current)
    setSplats((previous) => [...previous.slice(-31), mark])
  }, (sound, speed) => {
    const strength = .64 + Math.min(1, speed / 2200) * .61
    playSound(sound, strength)
    scene.shareSound(sound, strength)
  })
  const { preferences: mascotPreferences, savePreferences, shareImpact, pushPeer, remote, meeting, hug } =
    useSharedMascot(mascotRoom, { ...pairing, receiveSplat: addRemoteSplat, scene: outgoingScene })
  const practice = useSharedMascot(null, {
    ...pairing, practice: clone.point ? { ...clone, point: clone.point } : null,
  })
  useEggSchedule(mascotRoom?.host ? hug : null, brood.lay)
  useEggSchedule(practice.hug, brood.lay)
  const scene = useMascotScene(outgoingScene, {
    room: mascotRoom, own: center(point), clone: { ...clone,
      greeting: practice.meeting?.near ? practice.meeting.kind : undefined,
      direction: pointBetween(clone.point ?? point, point) },
    hat, children: brood.children, childPosition: brood.position,
    peerPoint: remote ? center(remote.point) : null,
    receiveHit: (hit) => {
      if (hit.target === 'main') collide(hit.impulse, 'remote')
      else if (hit.target === 'clone') clone.boost(hit.impulse)
      else {
        const id = Number(hit.target.slice('young:'.length))
        if (hit.pop) brood.pop(id)
        else brood.bump(id, hit.impulse)
      }
      playSound('slimeKick', .8)
    },
    fireSound: (kind, strength = .75) => playSound(kind, strength),
  })
  brood.setPeerCount(scene.incoming?.young.length ?? 0)
  const otherClone = scene.incoming?.clone ? scene.project(scene.incoming.clone.point) : null
  const cloneObstacle = otherClone ? [{ target: 'clone' as const, point: { x: otherClone.x - 33, y: otherClone.y - 33 } }] : []
  useRemoteMascotCollisions({
    point, flight, held: grabbed, bounds, obstacles: cloneObstacle, relocate: relocateMascot,
    kick: (impulse, recoil, from) => collide(impulse, recoil ? 'local' : 'remote', from),
    hitPeer: (target, impulse) => scene.hitPeer(target, impulse, false),
  })
  useRemoteMascotCollisions({
    point: clone.point, flight: clone.flight, held: clone.held, bounds,
    obstacles: [...cloneObstacle, ...(remote ? [{ target: 'main' as const, point: remote.point }] : [])],
    relocate: clone.relocate, kick: clone.boost,
    hitPeer: (target, impulse) => scene.hitPeer(target, impulse, false),
  })
  const showingRemote = !!remote
  useEffect(() => {
    if (!showingRemote) setSplats((marks) => marks.some((mark) => mark.remote) ? marks.filter((mark) => !mark.remote) : marks)
  }, [showingRemote])
  const VisibilityIcon = mascotPreferences.remote === 'hidden' ? EyeOff : Eye
  const greeting = meeting?.near ? meeting.kind : undefined
  const cloneGreeting = practice.meeting?.near ? practice.meeting.kind : undefined
  const meetingSound = meeting?.kind
  const meetingKey = meeting ? [mascotRoom?.id, meeting.source, meeting.id].join('-') : null
  const cloneSound = practice.meeting?.kind
  const cloneKey = practice.meeting?.id
  useEffect(() => { if (meetingSound) playSound(meetingSound === 'bump' ? 'slimeKick' : meetingSound) }, [meetingKey, meetingSound, playSound])
  useEffect(() => { if (cloneSound) playSound(cloneSound === 'bump' ? 'slimeKick' : cloneSound) }, [cloneKey, cloneSound, playSound])
  const pairDirection = pointBetween(point, remote?.point)
  const cloneDirection = pointBetween(point, clone.point)
  const targets: ShotTarget[] = []
  const broodActors: BroodActor[] = [{ id: 'own', point: center(point), active: grabbed || !!flight }]
  if (mascotRoom?.rich && remote && mascotPreferences.shareOwn) targets.push({ target: 'peer', point: center(remote.point) })
  if (clone.point) targets.push({ target: 'clone', point: center(clone.point) })
  if (scene.incoming?.clone) targets.push({ target: 'remoteClone', point: scene.project(scene.incoming.clone.point) })
  for (const child of scene.incoming?.young ?? []) {
    if (child.phase === 'young' && !child.held) targets.push({ target: `remoteYoung:${child.id}`, point: scene.project(child.point), radius: 17 })
  }
  if (clone.point) broodActors.push({ id: 'clone', point: center(clone.point), active: clone.held || !!clone.flight })
  if (remote) broodActors.push({ id: 'peer', point: center(remote.point), active: remote.pose === 'held' || !!remote.flight })
  if (otherClone) broodActors.push({ id: 'peer-clone', point: otherClone, active: true })
  for (const child of scene.incoming?.young ?? []) {
    if (child.phase === 'young') broodActors.push({ id: 'peer-young-' + child.id, point: scene.project(child.point), active: true, radius: 17 })
  }
  brood.collideWith(broodActors)
  for (const child of brood.children) {
    if (child.phase === 'young' && !child.held) targets.push({ target: `young:${child.id}`, point: brood.position(child), radius: 17 })
  }
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

  function savePosition(next: LauncherPosition) {
    setCollisionRest(null)
    setPlacement(next)
    try { localStorage.setItem(launcherPreference, JSON.stringify(next)) } catch { /* Placement remains active. */ }
  }

  function place(side: Side, y: number) {
    savePosition({ side, y: clamp(y, endY, startY) })
  }

  function grab(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary) return
    if (cancelFlight.current) {
      cancelFlight.current()
      cancelFlight.current = null
      // Freeze in place while held so the next release starts under the pointer.
      setDragPoint({ x: point.x, y: point.y })
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
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? []
    for (const sample of samples.length ? samples : [event.nativeEvent]) {
      active.samples.push({ x: sample.clientX, y: sample.clientY, time: sample.timeStamp })
    }
    active.samples = active.samples.slice(-32)
    if (!active.moved && Math.hypot(event.clientX - active.origin.x, event.clientY - active.origin.y) < 4) return
    active.moved = true
    setDragPoint(releasePoint(event.clientX, event.clientY, active.offset))
  }

  function releasePoint(x: number, y: number, offset: Point): Point {
    return {
      x: clamp(x - offset.x, bounds.right, bounds.left),
      y: clamp(y - offset.y, bounds.bottom, bounds.top),
    }
  }

  function release(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current
    if (!active || active.id !== event.pointerId) return
    const intercepted = !active.moved && !!dragPoint
    drag.current = null
    setGrabbed(false)
    setDragPoint(null)
    moved.current = active.moved
    const from = releasePoint(event.clientX, event.clientY, active.offset)
    if (intercepted) {
      settle({ x: from.x, y: bounds.bottom })
      return
    }
    if (!active.moved || event.type !== 'pointerup') return
    const shiftX = event.clientX - active.origin.x
    const shiftY = event.clientY - active.origin.y
    const other = side === 'left' ? 'right' : 'left'
    const inward = side === 'left' ? shiftX : -shiftX
    const sideChange = inward >= Math.max(sideGesture, Math.abs(shiftY) / 3) || edgeAt(from.x, width) !== side
    const nextSide = sideChange ? other : side
    lastPointer.current = { x: event.clientX, y: event.clientY }
    const velocity = throwVelocity(active.samples, { ...lastPointer.current, time: event.timeStamp })
    if (velocity && bounds.bottom - bounds.top > 72 && bounds.right - bounds.left > 72
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      playSound('throw', .7 + Math.min(1, Math.hypot(velocity.x, velocity.y) / 2350) * .65)
      throwMascot(from, velocity)
      return
    }
    place(nextSide, from.y)
    const docked = { x: nextSide === 'left' ? launcherMargin : endX, y: clamp(from.y, endY, startY) }
    if (frightened) setPointerNear(pointerDistance(lastPointer.current, docked) < 87)
    else if (sideChange) {
      setSplats((previous) => previous.filter((mark) => pointerDistance(mark, docked) > 86))
      setReaction('relieved')
    } else setReaction('protesting')
  }

  function settle(rest: Point) {
    const { left, right } = boundsRef.current
    const ratio = clamp((rest.x - left) / Math.max(1, right - left), 1, 0)
    savePosition({ side: 'bottom', ratio })
    setPointerNear(!!lastPointer.current && pointerDistance(lastPointer.current, rest) < 87)
  }

  function addRemoteSplat(impact: Impact) {
    playSound('bounceOffWall', .42 + impact.strength * .5)
    const mark = { ...makeSplat(impact, launcherSize, ++nextSplat.current), remote: true }
    setSplats((previous) => [...previous.slice(-31), mark])
  }

  function collide(impulse: MascotImpulse, source: 'local' | 'remote' | 'toy' = 'toy', from?: Point) {
    if (drag.current) return
    playSound('slimeKick', .6 + Math.min(impulse.strength / 1700, 1) * .63)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReaction('protesting')
      return
    }
    const { direction, strength } = impulse
    const sign = source === 'local' ? -.88 : 1
    const carry = flight?.velocity ?? { x: 0, y: 0 }
    const motion = {
      x: direction.x * strength * sign + carry.x * .14,
      y: direction.y * strength * sign + carry.y * .14 - 180,
    }
    cancelFlight.current?.()
    throwMascot(from ?? { x: point.x, y: point.y }, motion)
  }

  function relocateMascot(next: Point) {
    cancelFlight.current?.()
    cancelFlight.current = null
    setFlight(null)
    if (drag.current) setDragPoint(next)
    else setCollisionRest(next)
  }

  function throwMascot(from: Point, velocity: Point) {
    setFrightened(true)
    setFlight({ ...from, velocity, squash: 0, edge: 'bottom' })
    let lastTrail = -Infinity
    cancelFlight.current = animateThrow(from, velocity, () => boundsRef.current, (frame) => {
      setFlight(frame)
      const speed = Math.hypot(frame.velocity.x, frame.velocity.y)
      const now = performance.now()
      const strength = clamp(speed / 2650, 1, 0)
      if (speed < 650 || now - lastTrail < 69 - strength * 45) return
      lastTrail = now
      const mark = {
        id: ++nextSplat.current,
        x: frame.x + launcherSize / 2 - frame.velocity.x / speed * 24,
        y: frame.y + launcherSize / 2 - frame.velocity.y / speed * 24,
        angle: Math.atan2(frame.velocity.y, frame.velocity.x) * 180 / Math.PI,
        strength,
        width: 11 + strength * (14 + Math.random() * 13),
      }
      setTrail((previous) => [...previous.slice(-17), mark])
    }, (impact) => {
      playSound('bounceOffWall', .64 + impact.strength * .7)
      const mark = makeSplat(impact, launcherSize, ++nextSplat.current)
      setSplats((previous) => [...previous.slice(-31), mark])
      shareImpact(impact)
    }, (rest) => {
      cancelFlight.current = null
      setFlight(null)
      settle(rest)
    })
  }

  function close() {
    setOpen(false)
    launcher.current?.focus()
  }

  function chooseTool(next: MascotTool) {
    setTool(next)
    setToolsOpen(false)
    close()
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
      setChat((turns) => [...turns, { role: 'user', content: prompt }])
      setDraft('')
      const result = await systemDiagram.converse(provider, { prompt, screen, history, diagram, documents: attachments })
      const change = result.diagram ? await onDiagram(result.diagram, diagram, screen) : undefined
      setChat((turns) => [...turns, { role: 'assistant', content: result.reply, change }])
    })
  }

  return <>
    {open && <section ref={dock} id="assistant-dock" className="assistant-dock" aria-label="Assistente de IA" style={panel}
      onKeyDown={(event) => { if (event.key === 'Escape' && !event.defaultPrevented) close() }}>
      <header className="assistant-heading">
        <h2><Sparkles size={17} />Assistente de IA</h2>
        <div className="assistant-heading-actions">
          {mascotRoom && <button className={'icon-button assistant-mascots-trigger is-' + mascotPreferences.remote}
            type="button" aria-label="Visibilidade das Jujubas" title="Visibilidade das Jujubas" aria-expanded={mascotOptions}
            aria-controls={mascotOptions ? 'assistant-mascots' : undefined}
            onClick={() => { setMascotOptions(!mascotOptions); setHatsOpen(false); setToolsOpen(false) }}><VisibilityIcon size={18} aria-hidden="true" /></button>}
          <button className="icon-button assistant-hats-trigger" type="button" aria-label="Chapéus" title="Chapéus"
            aria-expanded={hatsOpen} aria-controls={hatsOpen ? 'assistant-hats' : undefined}
            onClick={() => { setHatsOpen(!hatsOpen); setMascotOptions(false); setToolsOpen(false) }}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
              strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 15-1-9c0-1.2 3-2 7-2s7 .8 7 2l-1 9M6 12c2.7 1 9.3 1 12 0" />
              <path d="M6 15c-2.6.5-4 1.4-4 2.3 0 1.6 4.5 2.7 10 2.7s10-1.1 10-2.7c0-.9-1.4-1.8-4-2.3" />
            </svg>
          </button>
          <button className="icon-button" type="button" title="Ferramentas e sons" aria-label="Ferramentas e sons"
            aria-expanded={toolsOpen} aria-controls={toolsOpen ? 'assistant-tools' : undefined}
            onClick={() => { setToolsOpen(!toolsOpen); setHatsOpen(false); setMascotOptions(false) }}>
            <Wrench size={17} aria-hidden="true" />
          </button>
          <button className="icon-button" onClick={close} aria-label="Fechar assistente" title="Fechar assistente"><X size={17} /></button>
        </div>
      </header>
      {toolsOpen && <div id="assistant-tools" className="assistant-tools" role="group" aria-label="Ferramentas e sons da Jujuba">
        <div className="assistant-toys" role="group" aria-label="Brinquedos">
          {(Object.keys(toyLabels) as MascotTool[]).map((option) => <button className="button" type="button" key={option}
            onClick={() => chooseTool(option)}><MascotToyIcon tool={option} />{toyLabels[option]}</button>)}
        </div>
        <div className="assistant-tool-row mascot-clone-row">
          <span><Copy size={16} aria-hidden="true" />Clone de teste</span>
          <button className="button" type="button" aria-label={clone.point ? 'Remover clone de teste' : 'Criar clone de teste'} onClick={() => {
            clone.keepOrRemove(point)
            setToolsOpen(false)
            close()
          }}>{clone.point ? 'Remover' : 'Criar'}</button>
        </div>
        <div className="assistant-tool-row assistant-sounds">
          <label htmlFor="jujuba-volume">Som Gelatina</label>
          <input id="jujuba-volume" type="range" min={0} max={100} value={Math.round(sound.volume * 100)} aria-label="Volume das Jujubas"
            onChange={(event) => saveSound({ muted: false, volume: Number(event.target.value) / 100 })} />
          <button className="icon-button" type="button" aria-label="Silenciar Jujubas" title="Silenciar Jujubas" aria-pressed={sound.muted}
            onClick={() => saveSound({ ...sound, muted: !sound.muted })}>{sound.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
          <button className="icon-button" type="button" aria-label="Ouvir exemplo" title="Ouvir exemplo"
            disabled={sound.muted || !sound.volume} onClick={() => playSound('bounceOffWall')}><Play size={15} aria-hidden="true" /></button>
        </div>
      </div>}
      {hatsOpen && <div id="assistant-hats" className="assistant-hats" role="group" aria-label="Chapéus da Jujuba">
        {(Object.keys(hats) as Hat[]).map((option) => <button key={option} className="button" type="button"
          aria-pressed={hat === option} onClick={() => { setHat(option); saveHat(option) }}>
          {option === 'none' ? <span className="hat-miniature" aria-hidden="true">—</span> : <MascotHat hat={option} miniature />}
          <span>{hats[option]}</span>
        </button>)}
      </div>}
      {mascotRoom && mascotOptions && <div id="assistant-mascots" className="assistant-mascots" aria-label="Jujubas da sessão">
        <label>Jujuba de {mascotRoom.peer}
          <select value={mascotPreferences.remote} onChange={(event) => savePreferences({
            ...mascotPreferences, remote: event.target.value as MascotVisibility,
          })}>
            <option value="dim">Discreta</option>
            <option value="full">Mais visível</option>
            <option value="hidden">Invisível</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={mascotPreferences.shareOwn}
            onChange={(event) => savePreferences({ ...mascotPreferences, shareOwn: event.target.checked })} />
          Mostrar a minha Jujuba para a outra pessoa
        </label>
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
          {turn.change && <small className={turn.change.applied ? 'assistant-change applied' : 'assistant-change'}>
            {turn.change.message}
          </small>}
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
          value={draft} maxLength={4000} onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            if (!event.repeat) send()
          }} />
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
    {splats.filter((mark) => !mark.remote || remote).map((mark) => <MascotSplat key={mark.id} mark={mark}
      remove={() => setSplats((previous) => previous.filter((entry) => entry.id !== mark.id))} />)}
    {trail.map((mark) => <span key={mark.id} className="jujuba-trail" aria-hidden="true" style={{
      left: mark.x, top: mark.y, width: mark.width, height: 3 + mark.strength * 7,
      transform: `translate(-50%, -50%) rotate(${mark.angle}deg)`,
      animationDuration: `${250 + mark.strength * 390}ms`,
    }} onAnimationEnd={() => setTrail((previous) => previous.filter((entry) => entry.id !== mark.id))} />)}
    {mascotRoom && remote && <SharedMascot key={'peer-' + mascotRoom.id} peer={mascotRoom.peer}
      appearance={remote} visibility={mascotPreferences.remote} greeting={greeting}
      direction={{ x: -pairDirection.x, y: -pairDirection.y }} />}
    {meeting && <MascotMeetingEffect key={meeting.source + '-' + meeting.id} kind={meeting.kind} point={meeting.point} />}
    {scene.incoming && <SharedMascotScene scene={scene.incoming} project={scene.project}
      visibility={mascotPreferences.remote} peer={mascotRoom?.peer ?? ''} />}
    {brood.children.map((child) => <MascotYoung key={child.id} child={child} at={brood.position(child)}
      onHatch={() => { brood.hatch(child.id); playSound('hatch'); scene.shareSound('hatch', .65) }}
      onTouch={() => {
        brood.touch(child.id)
        playSound('bounce', .52)
      }}
      onGrab={(event) => brood.grab(child.id, event)} onMove={brood.move} onRelease={brood.release}
      onGone={() => brood.remove(child.id)} />)}
    {clone.point && <>
      <button type="button" aria-label="Clone de teste da Jujuba" title="Clone de teste · arraste para mover"
        className={`assistant-clone${clone.held ? ' is-grabbed is-dragging' : ''}${clone.flight ? ' is-flying' : ''}`}
        style={{ left: clone.point.x, top: clone.point.y }} onClick={() => playSound('click')}
        onPointerDown={clone.grab} onPointerMove={clone.move} onPointerUp={clone.release}
        onPointerCancel={clone.release} onLostPointerCapture={clone.release}
        onKeyDown={(event) => {
          const x = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          const y = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
          if (!x && !y) return
          event.preventDefault()
          const step = event.shiftKey ? 36 : 12
          clone.nudge(x * step, y * step)
        }}>
        <JujubaMascot followPointer grabbed={clone.held} flight={clone.flight} hat={hat} greeting={cloneGreeting}
          direction={{ x: -cloneDirection.x, y: -cloneDirection.y }} />
        <span className="mascot-clone-label" aria-hidden>Clone</span>
      </button>
      {practice.meeting && <MascotMeetingEffect key={practice.meeting.id} kind={practice.meeting.kind} point={practice.meeting.point} />}
    </>}
    {tool && <MascotAim key={mascotRoom?.id ?? screen} tool={tool}
      own={center(point)} targets={targets}
      onExit={() => { setTool(null); launcher.current?.focus() }}
      onFire={(power) => playSound(tool, .64 + power * .5)}
      onTension={tension}
      onVisual={scene.setToy}
      onRicochet={() => { if (tool === 'bow') playSound('ricochet') }}
      onHit={(target, impulse) => {
        if (target === 'peer') pushPeer(impulse)
        else if (target === 'remoteClone') scene.hitPeer('clone', impulse, false)
        else if (target.startsWith('remoteYoung:')) scene.hitPeer(`young:${Number(target.slice('remoteYoung:'.length))}`, impulse, tool === 'blaster')
        else if (target === 'clone') practice.pushPeer(impulse)
        else if (target === 'own') collide(impulse)
        else {
          const id = Number(target.slice('young:'.length))
          if (tool === 'blaster') brood.pop(id)
          else brood.bump(id, impulse)
          playSound('hit', .65)
        }
      }} />}
    <button ref={launcher} className={`assistant-launch${grabbed ? ' is-grabbed' : ''}${dragPoint ? ' is-dragging' : ''}${flight ? ' is-flying' : ''}${expression ? ' is-' + expression : ''}`}
      style={{ left: point.x, top: point.y }} aria-label={open ? 'Fechar assistente' : 'Abrir assistente de IA'}
      title="Assistente de IA · arraste para mover ou solte rápido para arremessar" aria-expanded={open} aria-controls={open ? 'assistant-dock' : undefined}
      onPointerDown={grab} onPointerMove={move} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
      onKeyDown={(event) => {
        const locations: Record<string, { side: Side; y: number }> = {
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
        playSound('click')
        setFrightened(false)
        setPointerNear(false)
        if (open) close()
        else setOpen(true)
      }}>
      <JujubaMascot followPointer grabbed={grabbed} equipped={tool === 'blaster'} reaction={expression} flight={flight} hat={hat} greeting={cloneGreeting ?? greeting}
        direction={cloneGreeting ? cloneDirection : pairDirection} />
    </button>
  </>
}
