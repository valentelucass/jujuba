import { ArrowLeft, Bomb, Copy, Eye, EyeOff, FolderOpen, LoaderCircle, Paperclip, Play, Send, Sparkles, Volume2, VolumeX, Wrench, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { JujubaMascot } from './JujubaMascot'
import { MascotMeetingEffect, MascotYoung, SharedMascot } from './SharedMascot'
import { useSharedMascot } from '../controllers/useSharedMascot'
import { useMascotClone } from '../controllers/useMascotClone'
import { useBombMascots } from '../controllers/useBombMascots'
import { useMascotScene } from '../controllers/useMascotScene'
import { useRemoteMascotCollisions } from '../controllers/useRemoteMascotCollisions'
import { gooBombTiming, type GooBombPhase, type GooSplash, type MascotScene, type SceneHit } from '../models/mascotScene'
import { SharedMascotScene } from './SharedMascotScene'
import { GooBomb, GooBombAim } from './GooBomb'
import { useEggSchedule, useMascotBrood, type BroodActor } from '../controllers/useMascotBrood'
import type { ShotTarget } from '../controllers/mascotProjectile'
import { useMascotSound } from '../controllers/mascotSound'
import type { MascotImpulse, MascotPose, MascotRoom, MascotVisibility } from '../models/flowMascot'
import { MascotAim, MascotToyIcon, toyLabels, type MascotTool } from './MascotAim'
import { MascotPlayground } from './MascotPlayground'
import { MascotMagnet } from './MascotMagnet'
import { GestureControls, PlayTools, readGestures, saveGestures, type PlayTool } from './MascotPlayMenu'
import { useJellyPlay } from '../controllers/useJellyPlay'
import { JellyEffects } from './JellyEffects'
import { makeSplat, MascotSplat, type Splat } from './MascotSplat'
import { readHat, saveHat } from './MascotHat'
import { MascotAppearance } from './MascotAppearance'
import { appError, systemDiagram } from '../controllers/api'
import type { useAssistantSettings } from '../controllers/useAssistantSettings'
import { animateThrow, throwVelocity, type FlightBounds, type FlightFrame, type Impact, type Point, type PointerSample } from '../controllers/mascotMotion'
import type { AiProvider, AssistantFlowResult, ChatMessage, ReferenceDocument, SystemDiagram } from '../models/systemDiagram'

const assistants = {
  codex: { label: 'ChatGPT · Codex', login: 'Entre com sua conta do ChatGPT no Codex.' },
  claude: { label: 'Claude · Claude Code', login: 'Entre com sua conta no Claude Code.' },
  gemini: { label: 'Gemini · Gemini CLI', login: 'No Gemini CLI, escolha entrar com o Google.' },
} satisfies Record<AiProvider, { label: string; login: string }>

const effortLabels: Record<string, string> = {
  none: 'Desativado', minimal: 'Mínimo', low: 'Baixo', medium: 'Médio', high: 'Alto',
  xhigh: 'Extra alto', max: 'Máximo', ultra: 'Ultra', auto: 'Automático',
}

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
type Trail = Point & { id: number; color: string; angle: number; strength: number; width: number }

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
type DockSection = 'chat' | 'hats' | 'tools' | 'mascots'
const sectionTitles: Record<DockSection, string> = {
  chat: 'Assistente de IA', hats: 'Aparência', tools: 'Ferramentas e sons', mascots: 'Jujubas da sessão',
}

export function readProvider(): AiProvider {
  try {
    const value = localStorage.getItem(preference)
    if (value === 'claude' || value === 'gemini') return value
  } catch { /* The assistant can still be selected in this session. */ }
  return 'codex'
}

export function AssistantDock({ open, setOpen, provider, setProvider, settings, screen, diagram, onDiagram, mascotRoom, color, changeColor }: {
  open: boolean
  color: string
  changeColor: (color: string) => void
  setOpen: (open: boolean) => void
  provider: AiProvider
  setProvider: (provider: AiProvider) => void
  settings: ReturnType<typeof useAssistantSettings>
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
  const [section, setSection] = useState<DockSection>('chat')
  const [settingsHeight, setSettingsHeight] = useState(615)
  const activeSection = section === 'mascots' && !mascotRoom ? 'chat' : section
  const inChat = activeSection === 'chat'
  const [tool, setTool] = useState<MascotTool | PlayTool | 'bomb' | null>(null)
  const [gestures, setGestures] = useState(readGestures)
  const [blast, setBlast] = useState<{ point: Point; phase: GooBombPhase; room?: string; source?: string; splash?: GooSplash } | null>(null)
  const blastTimer = useRef<number[]>([])
  const seenDrag = useRef<{ room?: string; sequence: number }>({ sequence: 0 })
  const { settings: sound, save: saveSound, play: playSound, tension, playBomb, stopBomb } = useMascotSound()
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
  const impactColor = useRef(color)
  impactColor.current = color
  const lastPointer = useRef<Point | null>(null)
  const moved = useRef(false)
  const lock = useRef(false)
  const dock = useRef<HTMLElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const end = useRef<HTMLLIElement>(null)

  useLayoutEffect(() => {
    const element = dock.current
    if (!open || inChat || !element) return
    const measure = () => setSettingsHeight(element.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [activeSection, inChat, open])

  useEffect(() => {
    if (!open) setSection('chat')
    else if (inChat) composer.current?.focus()
  }, [open, inChat])
  useEffect(() => { if (open && inChat) end.current?.scrollIntoView({ block: 'nearest' }) }, [chat, busy, open, inChat])
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
  const clone = useMascotClone(bounds, (impact) => {
    playSound('bounceOffWall', .64 + impact.strength * .7)
    scene.shareSound('bounceOffWall', .64 + impact.strength * .7)
    const mark = makeSplat(impact, launcherSize, ++nextSplat.current, impactColor.current)
    setSplats((previous) => [...previous.slice(-31), mark])
  }, (sound, speed) => {
    const strength = .64 + Math.min(1, speed / 2200) * .61
    playSound(sound, strength)
    scene.shareSound(sound, strength)
  })

  const bombMascots = useBombMascots({
    bounds,
    main: { point, place: relocateMascot, launch: (from, velocity) => throwMascot(from, velocity, true), releaseGrip: () => {
      const pointer = drag.current?.id
      drag.current = null
      setGrabbed(false)
      setDragPoint(null)
      if (pointer !== undefined && launcher.current?.hasPointerCapture(pointer)) launcher.current.releasePointerCapture(pointer)
    } },
    clone: clone.point ? { point: clone.point, place: clone.relocate, launch: clone.launch, releaseGrip: clone.releaseGrip } : null,
  })
  const pairing = { position: point, bounds, hat, color, flight, pose, kick: collide, relocate: relocateMascot, gathering: bombMascots.moving }
  const { preferences: mascotPreferences, savePreferences, shareImpact, remote, meeting, hug,
    members, visible, selectedPeer, visibilityFor, quiet } =
    useSharedMascot(mascotRoom, { ...pairing, receiveSplat: addRemoteSplat, scene: outgoingScene })
  const jelly = useJellyPlay({ ...gestures, paused: quiet }, playSound)
  const practice = useSharedMascot(null, {
    ...pairing, practice: !quiet && clone.point ? { ...clone, point: clone.point } : null,
  })
  useEggSchedule(hug, brood.lay)
  useEggSchedule(practice.hug, brood.lay)
  const interacting = !quiet && mascotPreferences.shareOwn
  const scene = useMascotScene(outgoingScene, {
    room: mascotRoom, own: center(point), clone: { ...clone,
      greeting: practice.meeting?.near ? practice.meeting.kind : undefined,
      direction: pointBetween(clone.point ?? point, point) },
    hat, children: brood.children, childPosition: brood.position, members, visible, active: interacting,
    receiveHit: (hit) => {
      if (bombMascots.moving && (hit.target === 'main' || hit.target === 'clone')) return
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
    receiveBurst: startBlast,
  })
  const visibleIds = new Set(visible.map(({ member }) => member.id))
  useEffect(() => {
    if (seenDrag.current.room !== mascotRoom?.id) seenDrag.current = { room: mascotRoom?.id, sequence: 0 }
    brood.releaseHidden(interacting ? visibleIds : new Set())
    for (const { sequence, from, drag } of mascotRoom?.childDrags ?? []) {
      if (sequence <= seenDrag.current.sequence) continue
      seenDrag.current.sequence = sequence
      if (interacting && visibleIds.has(from)) brood.remoteDrag(from, drag)
    }
  }, [mascotRoom?.id, mascotRoom?.childDrags, visible, interacting])

  function startBlast(center: Point, affectsOwn: boolean, source?: string, targets?: string[]) {
    if (blastTimer.current.length || quiet) return false
    const initial = { point: center, room: mascotRoom?.id, source }
    setBlast({ ...initial, phase: 'falling' })
    playBomb()
    const { landing, pull, burst, end } = gooBombTiming
    blastTimer.current = [
      window.setTimeout(() => {
        setBlast({ ...initial, phase: 'landed' })
      }, landing),
      window.setTimeout(() => {
        setBlast({ ...initial, phase: 'charging' })
        if (affectsOwn && (!source || sharedPlay.current)) {
          pullingOwn.current = true
          broodRef.current.startPull(center, burst - pull)
          const self = mascotRoom?.selfId
          const invited = targets ?? (sharedPlay.current ? [...visibleIds] : [])
          const peers = self ? [...new Set([self, ...(source ? [source] : []), ...invited])].sort() : []
          const seat = self ? peers.indexOf(self) : Number(mascotRoom?.host === false)
          const participants = self ? peers.length : (mascotRoom ? 2 : 1)
          bombMascots.start(center, burst - pull, { seat, participants })
        }
      }, pull),
      window.setTimeout(() => {
        const participants = visibleBroods.current.filter(({ member }) => !targets || member.id === source || targets.includes(member.id))
        const young = [
          ...(affectsOwn ? broodRef.current.children : []), ...participants.flatMap(({ scene }) => scene.young),
        ].filter(({ phase, dissolving }) => phase !== 'popping' || !!dissolving)
        const splash = young.length ? { bodies: young.length } : undefined
        if (pullingOwn.current) {
          broodRef.current.endPull(true)
          bombMascots.burst()
          pullingOwn.current = false
        }
        setBlast({ ...initial, phase: 'burst', splash })
        blastTimer.current.push(window.setTimeout(() => {
          setBlast(null)
          blastTimer.current = []
        }, (splash ? gooBombTiming.stainEnd : end) - burst))
      }, burst),
    ]
    return true
  }

  function launchBomb(center: Point) {
    setTool(null)
    if (startBlast(center, true)) scene.setBurst(center)
  }

  const broodRef = useRef(brood)
  broodRef.current = brood
  const pullingOwn = useRef(false)
  const sharedPlay = useRef(interacting)
  sharedPlay.current = interacting
  const visibleBroods = useRef(scene.scenes)
  visibleBroods.current = scene.scenes
  const blastHidden = !!blast && (blast.room !== mascotRoom?.id || (!!blast.source && !visibleIds.has(blast.source)))
  useEffect(() => {
    if (!blast?.source || interacting) return
    if (pullingOwn.current) broodRef.current.endPull(false)
    pullingOwn.current = false
    bombMascots.cancel()
  }, [blast?.source, interacting])
  useEffect(() => {
    if (!quiet && !blastHidden) return
    if (quiet) {
      setTool(null)
    }
    for (const timer of blastTimer.current) window.clearTimeout(timer)
    blastTimer.current = []
    setBlast(null)
    pullingOwn.current = false
    bombMascots.cancel()
    broodRef.current.endPull(false)
    stopBomb()
  }, [quiet, blastHidden, stopBomb])
  useEffect(() => () => { for (const timer of blastTimer.current) window.clearTimeout(timer) }, [])

  brood.setPeerCount(members.reduce((count, member) => count + (member.mascot?.scene?.young.length ?? 0), 0))
  const companions = scene.scenes.flatMap(({ member, scene: body, project }) =>
    body.clone ? [{ target: 'clone' as const, peer: member.id, point: project(body.clone.point) }] : [])
  const primaryObstacles = visible.map(({ member, appearance }) =>
    ({ target: 'main' as const, peer: member.id, point: appearance.point }))
  const cloneObstacles = companions.map(({ point: at, ...character }) =>
    ({ ...character, point: { x: at.x - 33, y: at.y - 33 } }))
  useRemoteMascotCollisions({
    point, flight, held: grabbed, bounds, obstacles: interacting && !bombMascots.moving
      ? [...cloneObstacles, ...primaryObstacles.filter(({ peer }) => peer !== selectedPeer)] : [], relocate: relocateMascot,
    kick: (impulse, recoil, from) => collide(impulse, recoil ? 'local' : 'remote', from),
    hitPeer: (target, impulse, peer) => scene.hitPeer(target, impulse, false, peer),
  })
  useRemoteMascotCollisions({
    point: clone.point, flight: clone.flight, held: clone.held, bounds,
    obstacles: interacting && !bombMascots.moving ? [...cloneObstacles, ...primaryObstacles] : [], relocate: clone.relocate, kick: clone.boost,
    hitPeer: (target, impulse, peer) => scene.hitPeer(target, impulse, false, peer),
  })
  const VisibilityIcon = quiet ? EyeOff : Eye
  const greeting = meeting?.near ? meeting.kind : undefined
  const cloneGreeting = quiet ? undefined : practice.meeting?.near ? practice.meeting.kind : undefined
  const meetingSound = meeting?.kind
  const meetingKey = meeting ? [mascotRoom?.id, selectedPeer, meeting.source, meeting.id].join('-') : null
  const cloneSound = quiet ? undefined : practice.meeting?.kind
  const cloneKey = practice.meeting?.id
  useEffect(() => { if (meetingSound) playSound(meetingSound === 'bump' ? 'slimeKick' : meetingSound) }, [meetingKey, meetingSound, playSound])
  useEffect(() => { if (cloneSound) playSound(cloneSound === 'bump' ? 'slimeKick' : cloneSound) }, [cloneKey, cloneSound, playSound])
  const pairDirection = pointBetween(point, remote?.point)
  const cloneDirection = pointBetween(point, clone.point)
  const targets: ShotTarget[] = []
  const broodActors: BroodActor[] = quiet ? [] : [{ id: 'own', point: center(point), active: grabbed || !!flight }]
  if (clone.point && !quiet) {
    targets.push({ target: 'clone', point: center(clone.point) })
    broodActors.push({ id: 'clone', point: center(clone.point), active: clone.held || !!clone.flight })
  }
  for (const { member, appearance } of visible) {
    if (!interacting) continue
    targets.push({ target: `remote:${member.id}:main`, point: center(appearance.point) })
    broodActors.push({ id: member.id, point: center(appearance.point), active: appearance.pose === 'held' || !!appearance.flight })
  }
  for (const { peer, point } of companions) {
    if (!interacting) continue
    targets.push({ target: `remote:${peer}:clone`, point })
    broodActors.push({ id: peer + '-clone', point, active: true })
  }
  for (const { member, scene: body, project } of scene.scenes) {
    if (!interacting) continue
    for (const child of body.young) {
      if (child.phase !== 'young') continue
      const at = project(child.point)
      if (!child.held) targets.push({ target: `remote:${member.id}:young:${child.id}`, point: at, radius: 17 })
      broodActors.push({ id: member.id + '-young-' + child.id, point: at, active: true, radius: 17 })
    }
  }
  brood.collideWith(broodActors)
  for (const child of brood.children) {
    if (child.phase === 'young' && !child.held) targets.push({ target: `young:${child.id}`, point: brood.position(child), radius: 17 })
  }
  const dockAnchor = flight ? resting : point
  const dockWidth = Math.min(415, width - 28)
  const dockHeight = Math.min(inChat ? 615 : settingsHeight, height - 28)
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
    if (bombMascots.pulling || event.button !== 0 || !event.isPrimary) return
    jelly.resetGesture()
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
    jelly.move(event, active?.id === event.pointerId, !!flight)
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
    jelly.resetGesture()
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
    if (tool === 'trampoline' && !quiet) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) relocateMascot(from)
      else throwMascot(from, velocity ?? { x: 0, y: 0 })
      return
    }
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

  function addRemoteSplat(impact: Impact, peer: string, peerColor?: string) {
    playSound('bounceOffWall', .42 + impact.strength * .5)
    const mark = { ...makeSplat(impact, launcherSize, ++nextSplat.current, peerColor), remote: peer }
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

  function throwMascot(from: Point, velocity: Point, blastFlight = false) {
    setFrightened(true)
    setFlight({ ...from, velocity, squash: 0, edge: 'bottom' })
    let lastTrail = -Infinity
    const cancelThisFlight = animateThrow(from, velocity, () => boundsRef.current, (frame) => {
      setFlight(frame)
      if (blastFlight) return
      const speed = Math.hypot(frame.velocity.x, frame.velocity.y)
      const now = performance.now()
      const strength = clamp(speed / 2650, 1, 0)
      if (speed < 650 || now - lastTrail < 69 - strength * 45) return
      lastTrail = now
      const mark = {
        id: ++nextSplat.current, color: impactColor.current,
        x: frame.x + launcherSize / 2 - frame.velocity.x / speed * 24,
        y: frame.y + launcherSize / 2 - frame.velocity.y / speed * 24,
        angle: Math.atan2(frame.velocity.y, frame.velocity.x) * 180 / Math.PI,
        strength,
        width: 11 + strength * (14 + Math.random() * 13),
      }
      setTrail((previous) => [...previous.slice(-17), mark])
    }, (impact) => {
      if (blastFlight) return
      jelly.bounce(impact, launcherSize, impactColor.current)
      playSound('bounceOffWall', .64 + impact.strength * .7)
      const mark = makeSplat(impact, launcherSize, ++nextSplat.current, impactColor.current)
      setSplats((previous) => [...previous.slice(-31), mark])
      shareImpact(impact)
    }, (rest) => {
      cancelFlight.current = null
      setFlight(null)
      settle(rest)
    })
    cancelFlight.current = cancelThisFlight
    const active = () => cancelFlight.current === cancelThisFlight
    return { active, restore: (at: Point) => { if (active()) relocateMascot(at) } }
  }

  function close() {
    setOpen(false)
    launcher.current?.focus()
  }

  function chooseTool(next: NonNullable<typeof tool>) {
    setTool(next)
    close()
  }

  function toggleSection(next: DockSection) {
    setSection(activeSection === next ? 'chat' : next)
  }

  function putAwayToy() {
    setTool(null)
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
      settings.reload()
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
    if (!prompt || settings.unavailable) return
    void perform('Assistente trabalhando…', async () => {
      const history = chat.slice(-12).map(({ role, content }) => ({ role, content: content.slice(0, 2500) }))
      setChat((turns) => [...turns, { role: 'user', content: prompt }])
      setDraft('')
      const result = await systemDiagram.converse(provider, { prompt, screen, history, diagram, documents: attachments, options: settings.options })
      const change = result.diagram ? await onDiagram(result.diagram, diagram, screen) : undefined
      setChat((turns) => [...turns, { role: 'assistant', content: result.reply, change }])
    })
  }

  return <>
    {open && <section ref={dock} id="assistant-dock" className={'assistant-dock' + (inChat ? '' : ' is-settings')} aria-labelledby="assistant-section-title" style={panel}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        if (inChat) close()
        else setSection('chat')
      }}>
      <header className="assistant-heading">
        <div className="assistant-section-title">
          {!inChat && <button className="icon-button" type="button" aria-label="Voltar à conversa" title="Voltar à conversa"
            onClick={() => setSection('chat')}><ArrowLeft size={16} aria-hidden="true" /></button>}
          <h2 id="assistant-section-title">{inChat && <Sparkles size={17} />}<span>{sectionTitles[activeSection]}</span></h2>
        </div>
        <div className="assistant-heading-actions">
          {mascotRoom && <button className={'icon-button assistant-mascots-trigger is-' + mascotPreferences.remote}
            type="button" aria-label="Visibilidade das Jujubas" title="Visibilidade das Jujubas" aria-expanded={activeSection === 'mascots'}
            aria-controls={activeSection === 'mascots' ? 'assistant-mascots' : undefined}
            onClick={() => toggleSection('mascots')}><VisibilityIcon size={18} aria-hidden="true" /></button>}
          <button className="icon-button assistant-hats-trigger" type="button" aria-label="Chapéus e cor da Jujuba" title="Chapéus e cor da Jujuba"
            aria-expanded={activeSection === 'hats'} aria-controls={activeSection === 'hats' ? 'assistant-hats' : undefined}
            onClick={() => toggleSection('hats')}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
              strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 15-1-9c0-1.2 3-2 7-2s7 .8 7 2l-1 9M6 12c2.7 1 9.3 1 12 0" />
              <path d="M6 15c-2.6.5-4 1.4-4 2.3 0 1.6 4.5 2.7 10 2.7s10-1.1 10-2.7c0-.9-1.4-1.8-4-2.3" />
            </svg>
          </button>
          <button className="icon-button" type="button" title="Ferramentas e sons" aria-label="Ferramentas e sons"
            aria-expanded={activeSection === 'tools'} aria-controls={activeSection === 'tools' ? 'assistant-tools' : undefined}
            onClick={() => toggleSection('tools')}>
            <Wrench size={17} aria-hidden="true" />
          </button>
          <button className="icon-button" onClick={close} aria-label="Fechar assistente" title="Fechar assistente"><X size={17} /></button>
        </div>
      </header>
      {activeSection === 'tools' && <div id="assistant-tools" className="assistant-tools" role="group" aria-label="Ferramentas e sons da Jujuba">
        <div className="assistant-toys" role="group" aria-label="Brinquedos">
          <PlayTools choose={chooseTool} paused={quiet} magnetAvailable={brood.magnetAvailable} />
          {(Object.keys(toyLabels) as MascotTool[]).map((option) => <button className="button" type="button" key={option} disabled={quiet}
            onClick={() => chooseTool(option)}><MascotToyIcon tool={option} />{toyLabels[option]}</button>)}
          <button className="button assistant-goo-bomb" type="button" disabled={quiet || !!blast}
            onClick={() => chooseTool('bomb')}><Bomb size={16} aria-hidden="true" />Bomba atômica</button>
        </div>
        <GestureControls settings={gestures} paused={quiet} change={(next) => { setGestures(next); saveGestures(next) }} />
        <div className="assistant-tool-row mascot-clone-row">
          <span><Copy size={16} aria-hidden="true" />Clone de teste</span>
          <button className="button" type="button" aria-label={clone.point ? 'Remover clone de teste' : 'Criar clone de teste'} onClick={() => {
            clone.keepOrRemove(point)
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
      {activeSection === 'hats' && <MascotAppearance color={color} changeColor={changeColor} hat={hat}
        changeHat={(next) => { setHat(next); saveHat(next) }} />}
      {activeSection === 'mascots' && <div id="assistant-mascots" className="assistant-mascots" aria-label="Jujubas da sessão">
        <label>
          <input type="checkbox" checked={mascotPreferences.paused} onChange={(event) => savePreferences({
            ...mascotPreferences, paused: event.target.checked,
          })} />Pausar brincadeiras
        </label>
        {members.map(({ id, name }) => <label key={id}>Jujuba de {name}
          <select disabled={mascotPreferences.paused} value={mascotPreferences.byPeer[id] ?? mascotPreferences.remote}
            onChange={(event) => savePreferences(id === 'legacy' ? {
              ...mascotPreferences, remote: event.target.value as MascotVisibility,
            } : {
              ...mascotPreferences, byPeer: { ...mascotPreferences.byPeer, [id]: event.target.value as MascotVisibility },
            })}>
            <option value="dim">Discreta</option>
            <option value="full">Mais visível</option>
            <option value="hidden">Invisível</option>
          </select>
        </label>)}
        <label>
          <input type="checkbox" checked={mascotPreferences.shareOwn} disabled={mascotPreferences.paused}
            onChange={(event) => savePreferences({ ...mascotPreferences, shareOwn: event.target.checked })} />
          Mostrar minha Jujuba para a sala
        </label>
      </div>}
      {inChat && <><div className="assistant-config">
        <label className="sr-only" htmlFor="assistant-provider">Assistente</label>
        <select id="assistant-provider" value={provider} disabled={!!busy} onChange={(event) => chooseProvider(event.target.value as AiProvider)}>
          {Object.entries(assistants).map(([key, assistant]) => <option key={key} value={key}>{assistant.label}</option>)}
        </select>
        <button className="icon-button" onClick={chooseFolder} disabled={!!busy}
          title="Escolher pasta do projeto" aria-label="Escolher pasta do projeto"><FolderOpen size={17} /></button>
        <button className="button assistant-connection" aria-expanded={verifyOpen} onClick={() => setVerifyOpen(!verifyOpen)}>Conexão</button>
      </div>
      <div className="assistant-config assistant-models">
        <label><span id="assistant-model-label">Modelo</span>
          <select aria-labelledby="assistant-model-label" value={settings.options?.model ?? ''} disabled={!!busy || (!settings.models?.length && !settings.options?.model)}
            onChange={(event) => settings.chooseModel(event.target.value)}>
            <option value="">{!settings.models && !settings.error ? 'Carregando modelos…' : 'Padrão do assistente'}</option>
            {settings.options?.model && !settings.model && <option value={settings.options.model}>{settings.options.model}</option>}
            {settings.models?.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label><span id="assistant-effort-label">Raciocínio</span>
          <select aria-labelledby="assistant-effort-label" value={settings.options?.reasoningEffort ?? ''}
            disabled={!!busy || !settings.model || (!settings.model.reasoningEfforts.length && !settings.options?.reasoningEffort)}
            onChange={(event) => settings.chooseEffort(event.target.value)}>
            <option value="">{settings.model && !settings.model.reasoningEfforts.length ? 'Automático' : 'Padrão do assistente'}</option>
            {settings.options?.reasoningEffort && !settings.model?.reasoningEfforts.includes(settings.options.reasoningEffort) &&
              <option value={settings.options.reasoningEffort}>{effortLabels[settings.options.reasoningEffort] ?? settings.options.reasoningEffort}</option>}
            {settings.model?.reasoningEfforts.map((effort) => <option key={effort} value={effort}>{effortLabels[effort] ?? effort}</option>)}
          </select>
        </label>
      </div>
      {(settings.error || settings.unavailable || settings.models?.length === 0) && <div className="assistant-catalog-status" role="status">
        <span>{settings.error || settings.unavailable || 'O assistente não listou modelos.'}</span>
        {settings.error && <button type="button" className="detail-link" onClick={settings.reload}>Tentar novamente</button>}
      </div>}
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
          <button className="button primary" disabled={!draft.trim() || !!busy || !!settings.unavailable}><Send size={15} />Enviar</button>
        </div>
      </form></>}
    </section>}
    {!quiet && <JellyEffects effects={jelly.effects} />}
    {!quiet && splats.filter((mark) => !mark.remote || visibleIds.has(mark.remote)).map((mark) => <MascotSplat key={mark.id} mark={mark}
      remove={() => setSplats((previous) => previous.filter((entry) => entry.id !== mark.id))} />)}
    {!quiet && trail.map((mark) => <span key={mark.id} className="jujuba-trail" aria-hidden="true" style={{
      color: mark.color, left: mark.x, top: mark.y, width: mark.width, height: 3 + mark.strength * 7,
      transform: `translate(-50%, -50%) rotate(${mark.angle}deg)`,
      animationDuration: `${250 + mark.strength * 390}ms`,
    }} onAnimationEnd={() => setTrail((previous) => previous.filter((entry) => entry.id !== mark.id))} />)}
    {visible.map(({ member, appearance, visibility }) => <SharedMascot key={member.id} peer={member.name}
      appearance={appearance} visibility={visibility} greeting={member.id === selectedPeer ? greeting : undefined}
      witnessed={member.meeting?.peer && member.meeting.peer !== mascotRoom?.selfId && visibleIds.has(member.meeting.peer)
        ? member.meeting : undefined}
      direction={member.id === selectedPeer ? { x: -pairDirection.x, y: -pairDirection.y } :
        pointBetween(appearance.point, visible.find(({ member: other }) => other.id === member.meeting?.peer)?.appearance.point)} />)}
    {meeting && <MascotMeetingEffect key={meeting.source + '-' + meeting.id} kind={meeting.kind} point={meeting.point} />}
    {scene.scenes.map(({ member, scene, project, unproject, visibility }) => <SharedMascotScene
      key={member.id} color={member.mascot?.color} scene={scene} project={project} unproject={unproject} visibility={visibility}
      peer={member.name} peerId={member.id} room={interacting && member.group ? mascotRoom?.id : undefined} />)}
    {!quiet && brood.children.map((child) => <MascotYoung key={child.id} child={child} at={brood.position(child)}
      onHatch={() => { brood.hatch(child.id); playSound('hatch'); scene.shareSound('hatch', .65) }}
      onTouch={() => {
        brood.touch(child.id)
        playSound('bounce', .52)
      }}
      onGrab={(event) => brood.grab(child.id, event)} onMove={brood.move} onRelease={brood.release}
      onGone={() => brood.remove(child.id)} />)}
    {!quiet && clone.point && <>
      <button type="button" aria-label="Clone de teste da Jujuba" title="Clone de teste · arraste para mover"
        className={`assistant-clone${bombMascots.pulling ? ' is-bomb-pulled' : ''}${clone.held ? ' is-grabbed is-dragging' : ''}${clone.flight ? ' is-flying' : ''}`}
        style={{ left: clone.point.x, top: clone.point.y }} onClick={() => playSound('click')}
        onPointerDown={bombMascots.pulling ? undefined : clone.grab} onPointerMove={clone.move} onPointerUp={clone.release}
        onPointerCancel={clone.release} onLostPointerCapture={clone.release}
        onKeyDown={(event) => {
          const x = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          const y = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
          if (bombMascots.pulling || (!x && !y)) return
          event.preventDefault()
          const step = event.shiftKey ? 36 : 12
          clone.nudge(x * step, y * step)
        }}>
        <JujubaMascot color={color} followPointer grabbed={clone.held} flight={clone.flight} hat={hat} greeting={cloneGreeting}
          direction={{ x: -cloneDirection.x, y: -cloneDirection.y }} />
        <span className="mascot-clone-label" aria-hidden>Clone</span>
      </button>
      {practice.meeting && <MascotMeetingEffect key={practice.meeting.id} kind={practice.meeting.kind} point={practice.meeting.point} />}
    </>}
    {tool === 'bomb' && !quiet && <GooBombAim launch={launchBomb} cancel={putAwayToy} />}
    {tool === 'magnet' && !quiet && <MascotMagnet brood={brood} onExit={putAwayToy} />}
    {(tool === 'bubbles' || tool === 'trampoline' || tool === 'fan') && !quiet &&
      <MascotPlayground key={tool} tool={tool} point={point} held={grabbed} flight={flight} bounds={bounds} onPlace={relocateMascot}
        onLaunch={(from, velocity) => { cancelFlight.current?.(); throwMascot(from, velocity) }} onExit={putAwayToy} />}
    {blast && !quiet && !blastHidden && <GooBomb point={blast.point} phase={blast.phase} splash={blast.splash} />}
    {(tool === 'blaster' || tool === 'bow') && !quiet && <MascotAim key={mascotRoom?.id ?? screen} tool={tool}
      own={center(point)} targets={targets}
      onExit={putAwayToy}
      onFire={(power) => playSound(tool, .64 + power * .5)}
      onTension={tension}
      onVisual={scene.setToy}
      onRicochet={() => { if (tool === 'bow') playSound('ricochet') }}
      onHit={(target, impulse) => {
        if (target.startsWith('remote:')) {
          const [peer, ...parts] = target.slice('remote:'.length).split(':')
          const kind = parts.join(':') as SceneHit['target']
          scene.hitPeer(kind, impulse, tool === 'blaster' && kind.startsWith('young:'), peer)
        } else if (target === 'clone') practice.pushPeer(impulse)
        else if (target === 'own') collide(impulse)
        else {
          const id = Number(target.slice('young:'.length))
          if (tool === 'blaster') brood.pop(id)
          else brood.bump(id, impulse)
          playSound('hit', .65)
        }
      }} />}
    <button ref={launcher} className={`assistant-launch${bombMascots.pulling ? ' is-bomb-pulled' : ''}${tool === 'trampoline' ? ' on-trampoline' : ''}${grabbed ? ' is-grabbed' : ''}${dragPoint ? ' is-dragging' : ''}${flight ? ' is-flying' : ''}${expression ? ' is-' + expression : ''}`}
      style={{ left: point.x, top: point.y }} aria-label={open ? 'Fechar assistente' : 'Abrir assistente de IA'}
      title="Assistente de IA · arraste para mover ou solte rápido para arremessar" aria-expanded={open} aria-controls={open ? 'assistant-dock' : undefined}
      onPointerDown={grab} onPointerMove={move} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
      onPointerLeave={() => { if (!drag.current) jelly.resetGesture() }}
      onContextMenu={(event) => { if (tool === 'trampoline') { event.preventDefault(); putAwayToy() } }}
      onKeyDown={(event) => {
        const locations: Record<string, { side: Side; y: number }> = {
          ArrowLeft: { side: 'left', y: point.y }, ArrowRight: { side: 'right', y: point.y },
          ArrowUp: { side, y: point.y - 12 }, ArrowDown: { side, y: point.y + 12 },
        }
        const next = locations[event.key]
        if (next) {
          event.preventDefault()
          if (cancelFlight.current || bombMascots.pulling) return
          place(next.side, next.y)
        }
      }}
      onClick={(event) => {
        if (tool === 'trampoline' || (event.detail && moved.current)) return
        playSound('click')
        setFrightened(false)
        setPointerNear(false)
        if (open) close()
        else setOpen(true)
      }}>
      <JujubaMascot color={color} followPointer={!quiet} grabbed={grabbed} laughing={jelly.laughing} equipped={tool === 'blaster'} reaction={expression} flight={flight} hat={hat} greeting={cloneGreeting ?? greeting}
        direction={cloneGreeting ? cloneDirection : pairDirection} />
    </button>
  </>
}
