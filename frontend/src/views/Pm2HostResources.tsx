import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { ChevronDown, Pin, X } from 'lucide-react'
import type { HostProcessUsage, HostRank, HostResource, Pm2Host, Pm2Process } from '../models/pm2'
import { assessment, executable, useHostAnalysis } from '../controllers/useHostAnalysis'
import { Pm2MemoryInventory } from './Pm2MemoryInventory'

export interface ResourceCard {
  key: HostResource
  title: string
  icon: ReactNode
  body: ReactNode
  format: (value: number) => string
}

const names: Record<HostResource, string> = { cpu: 'CPU', memory: 'memória', gpu: 'GPU', disk: 'disco' }
const bases: Record<HostRank['basis'], string> = {
  cpuCapacity: 'Percentual da capacidade total de CPU do computador.',
  physicalMemory: 'Quanto da RAM física cada processo ocupa para uso próprio. O Windows também usa memória para o sistema, cache e páginas compartilhadas.',
  gpuEngine: 'Percentual de uso do motor de GPU mais ocupado de cada processo. O cartão mostra o motor mais ocupado do computador, somando todos os processos.',
  diskActivity: 'Leitura e gravação em disco por processo, como percentual da atividade de disco atribuída aos processos.',
  processIo: 'E/S do processo (inclui rede e dispositivos). O percentual usa a soma da leitura e gravação de todos os processos medidos.',
}
const percentage = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const percentText = (n: number) => n > 0 && n < 0.1 ? '< 0,1%' : percentage.format(n) + '%'

function positionRanking(anchor: HTMLElement, popup: HTMLElement, panel: HTMLElement) {
  const bounds = anchor.getBoundingClientRect()
  const view = window.visualViewport
  const startX = view?.offsetLeft ?? 0, startY = view?.offsetTop ?? 0
  const width = view?.width ?? window.innerWidth, height = view?.height ?? window.innerHeight
  // DOM rectangles use viewport pixels. A zoomed document can give the fixed popup a different CSS pixel size.
  const scale = popup.currentCSSZoom || 1
  const edge = 8 * scale, gap = 6 * scale
  const inventory = anchor.dataset.resource === 'memory'
  const popupWidth = Math.min(Math.max(bounds.width, (inventory ? 520 : 300) * scale), (inventory ? 580 : 380) * scale, width - 2 * edge)
  popup.style.width = Math.max(1, popupWidth / scale) + 'px'
  const endX = startX + width - edge, endY = startY + height - edge
  const anchorLeft = bounds.left + popupWidth > endX ? bounds.right - popupWidth : bounds.left
  const left = Math.max(startX + edge, Math.min(anchorLeft, endX - popupWidth))
  let topEdge = bounds.top, bottomEdge = bounds.bottom
  if (Math.max(topEdge - startY - edge, endY - bottomEdge) < Math.min(155 * scale, height * 0.45)) {
    const header = anchor.querySelector('h2')?.getBoundingClientRect()
    if (header) { topEdge = header.top; bottomEdge = header.bottom }
  }
  const above = topEdge - startY - edge, below = endY - bottomEdge
  const upward = (inventory || below < (panel.scrollHeight + 2) * scale + gap) && above > below
  panel.style.maxHeight = Math.max(1, ((upward ? above : below) - gap) / scale) + 'px'
  popup.dataset.side = upward ? 'above' : 'below'
  popup.style.left = left / scale + 'px'
  popup.style.top = (upward ? topEdge - popup.getBoundingClientRect().height : bottomEdge) / scale + 'px'
}

function ConsumerList({ card, rank, managed, identities, evaluated }: {
  card: ResourceCard; rank?: HostRank; managed: Map<number, Pm2Process>; identities: Map<number, HostProcessUsage>; evaluated?: Parameters<typeof assessment>[1]
}) {
  if (!rank || rank.status === 'unavailable') return <p>Detalhamento por processo indisponível nesta amostra.</p>
  if (rank.status === 'warming') return <p>Aguardando a próxima amostra para calcular o consumo.</p>
  const rows = rank.rows.filter((row): row is HostProcessUsage & { value: number; percent: number } =>
    row.value !== null && Number.isFinite(row.value) && row.value >= 0 && row.percent !== null && Number.isFinite(row.percent) && row.percent >= 0)
    .sort((a, b) => b.value - a.value || a.pid - b.pid).slice(0, 6)
  return <><p>{bases[rank.basis]}</p>
    {rows.length ? <ol className="pm2-consumers">{rows.map(row => {
      const identity = identities.get(row.pid)
      const sameName = !identity || executable(identity.name) === executable(row.name)
      const alias = sameName && managed.get(row.pid)?.name
      const opinion = evaluated && assessment(sameName && identity ? identity : row, evaluated)
      return <li key={row.pid}>
        <div className="pm2-consumer-title"><strong title={alias || row.name}>{alias || row.name}</strong>
          <span>{percentText(row.percent)}</span></div>
        <div className="pm2-consumer-meta"><span title={row.name}>{alias ? row.name + ' · ' : ''}PID {row.pid}</span>
          {(card.key === 'memory' || card.key === 'disk') && <span>{card.format(row.value)}</span>}</div>
        <div className="pm2-consumer-meter" aria-hidden="true"><i style={{ width: Math.min(row.percent, 100) + '%' }} /></div>
        {opinion && <small className="pm2-consumer-opinion">{opinion.label} · {opinion.detail}</small>}
      </li>
    })}</ol> : <p>Nenhum processo com consumo registrado nesta amostra.</p>}
  </>
}

export function Pm2HostResources({ cards, host, processes, hostSampledAt, pm2SampledAt, onDiskInspect, inspectMemoryRef }: {
  cards: ResourceCard[]; host: Pm2Host; processes: Pm2Process[]; hostSampledAt: number; pm2SampledAt?: number
  onDiskInspect?: (open: boolean) => void; inspectMemoryRef: Ref<() => void>
}) {
  const consumers = host.consumers
  const identities = useMemo(() => new Map(consumers?.memory?.rows.map(row => [row.pid, row])), [consumers?.memory])
  const managed = useMemo(() => {
    const matched = new Map<number, Pm2Process>()
    for (const process of processes) {
      if (process.pid == null || (process.startedAt != null && process.startedAt > hostSampledAt)) continue
      const birth = identities.get(process.pid)?.started
      if (pm2SampledAt !== undefined && birth && /^\d{1,20}$/.test(birth)) {
        // FILETIME counts 100 ns intervals from 1601. Both snapshot clocks use Unix milliseconds.
        const bornAt = Number(BigInt(birth) / 10000n) - 11644473600000
        if (bornAt > pm2SampledAt) continue
      }
      matched.set(process.pid, process)
    }
    return matched
  }, [processes, identities, hostSampledAt, pm2SampledAt])
  const inspection = useHostAnalysis()
  const evaluated = useMemo(() => new Map(inspection.data?.processes.map(r => [r.pid, r])), [inspection.data])
  const panelId = useId()
  const root = useRef<HTMLElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusRank = useRef(false)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [view, setView] = useState<{ key: HostResource; pinned: boolean } | null>(null)
  const active = cards.find(card => card.key === view?.key)
  const inspectingDisk = view?.key === 'disk'
  const inspect = useCallback((key: HostResource) => {
    focusRank.current = true
    root.current?.querySelector('.pm2-card[data-resource="' + key + '"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    setView({ key, pinned: true })
  }, [])
  const analyze = inspection.analyze
  const pinnedMemory = view?.key === 'memory' && view.pinned
  useEffect(() => { if (pinnedMemory) void analyze(false) }, [pinnedMemory, analyze])
  useImperativeHandle(inspectMemoryRef, () => () => { inspect('memory'); void analyze() }, [inspect, analyze])
  const activeKey = view?.key
  useLayoutEffect(() => {
    if (!activeKey) return
    const anchor = root.current?.querySelector<HTMLElement>('.pm2-card[data-resource="' + activeKey + '"]')
    const pop = popup.current, panel = pop?.firstElementChild
    if (!anchor || !pop || !(panel instanceof HTMLElement)) return
    pop.showPopover()
    const place = () => positionRanking(anchor, pop, panel)
    place()
    const observer = new ResizeObserver(place)
    observer.observe(anchor)
    observer.observe(panel)
    const visible = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) setView(null) })
    visible.observe(anchor)
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', place)
    viewport?.addEventListener('scroll', place)
    return () => {
      observer.disconnect()
      visible.disconnect()
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
      viewport?.removeEventListener('resize', place)
      viewport?.removeEventListener('scroll', place)
      if (pop.matches(':popover-open')) pop.hidePopover()
    }
  }, [activeKey])
  useLayoutEffect(() => {
    if (focusRank.current && view) { focusRank.current = false; heading.current?.focus({ preventScroll: true }) }
  }, [view])
  const rankTitle = active && (inspectingDisk && consumers?.disk?.basis === 'processIo'
    ? 'Processos por leitura e gravação (disco, rede e dispositivos)'
    : 'Processos por consumo de ' + names[active.key])
  useEffect(() => { onDiskInspect?.(inspectingDisk) }, [inspectingDisk, onDiskInspect])
  useEffect(() => () => onDiskInspect?.(false), [onDiskInspect])
  const close = useCallback((restoreFocus: boolean) => {
    clearTimeout(dismissTimer.current)
    if (restoreFocus) root.current?.querySelector<HTMLButtonElement>('.pm2-resource-button[aria-expanded="true"]')?.focus({ preventScroll: true })
    setView(null)
  }, [])
  useEffect(() => {
    if (!view) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog:modal')) return
      close(!!root.current?.contains(document.activeElement))
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close(false)
    }
    document.addEventListener('keydown', escape)
    document.addEventListener('pointerdown', outside, true)
    return () => {
      document.removeEventListener('keydown', escape)
      document.removeEventListener('pointerdown', outside, true)
    }
  }, [view, close])
  useEffect(() => () => clearTimeout(dismissTimer.current), [])
  const preview = (key: HostResource) => setView(current => current?.pinned || current?.key === key ? current : { key, pinned: false })
  const toggle = (key: HostResource) => setView(current => current?.pinned && current.key === key ? null : { key, pinned: true })
  const leave = () => setView(current => current?.pinned ? current : null)
  return <section ref={root} className="pm2-host" aria-label="Recursos do computador"
    onPointerEnter={() => clearTimeout(dismissTimer.current)}
    onPointerLeave={() => {
      clearTimeout(dismissTimer.current)
      if (document.activeElement?.closest('[data-resource]')?.getAttribute('data-resource') !== view?.key) dismissTimer.current = setTimeout(leave, 150)
    }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) leave() }}>
    {cards.map(card => {
      const expanded = view?.key === card.key, pinned = expanded && view.pinned
      return <article key={card.key} className="pm2-card" data-resource={card.key} data-expanded={expanded || undefined}
        onPointerEnter={event => { if (event.pointerType === 'mouse' || event.pointerType === 'pen') preview(card.key) }}
        onClick={event => {
          event.currentTarget.querySelector('button')?.focus({ preventScroll: true })
          toggle(card.key)
        }}>
        <h2><button type="button" className="pm2-resource-button" aria-expanded={expanded} aria-pressed={pinned}
          aria-controls={expanded ? panelId : undefined} aria-label={card.title + ', consumo por processo'}
          onFocus={() => preview(card.key)} onKeyDown={event => {
            if (event.key === 'ArrowDown' || (!pinned && (event.key === 'Enter' || event.key === ' '))) { event.preventDefault(); inspect(card.key) }
          }} title={pinned ? 'Fechar detalhes' : 'Fixar detalhes (Enter ou ↓)'}>
          {card.icon}<span>{card.title}</span>{pinned ? <Pin size={13} /> : <ChevronDown size={14} />}</button></h2>
        {card.body}
      </article>
    })}
    {active && <div className="pm2-rank-popup" ref={popup} popover="manual" onPointerEnter={() => clearTimeout(dismissTimer.current)}>
      <section className="pm2-rank" id={panelId} data-resource={active.key} aria-label={rankTitle || undefined}>
      <div className="pm2-rank-title"><h3 ref={heading} tabIndex={-1}>{rankTitle}</h3>
        {view?.pinned && <Pin size={13} aria-label="Fixado" />}
        <button type="button" className="icon-button" aria-label="Fechar detalhes do recurso" onClick={() => close(true)}><X size={14} /></button></div>
      {active.key === 'memory'
        ? <Pm2MemoryInventory host={host} managed={managed} format={active.format} inspection={inspection} evaluated={evaluated}/>
        : <ConsumerList card={active} rank={consumers?.[active.key]} managed={managed} identities={identities} evaluated={inspection.data ? evaluated : undefined} />}
    </section></div>}
  </section>
}
