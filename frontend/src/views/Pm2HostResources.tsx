import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { ChevronDown, Pin, X } from 'lucide-react'
import type { HostRank, HostResource, Pm2Host, Pm2Process } from '../models/pm2'

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

function ConsumerList({ card, rank, processes }: { card: ResourceCard; rank?: HostRank; processes: Pm2Process[] }) {
  if (!rank || rank.status === 'unavailable') return <p>Detalhamento por processo indisponível nesta amostra.</p>
  if (rank.status === 'warming') return <p>Aguardando a próxima amostra para calcular o consumo.</p>
  const rows = rank.rows.filter(row => Number.isFinite(row.value) && row.value >= 0 && Number.isFinite(row.percent) && row.percent >= 0)
    .sort((a, b) => b.value - a.value || a.pid - b.pid).slice(0, 6)
  const pm2Names = new Map(processes.map(p => [p.pid, p.name]))
  return <><p>{bases[rank.basis]}</p>
    {rows.length ? <ol className="pm2-consumers">{rows.map(row => {
      const alias = pm2Names.get(row.pid)
      return <li key={row.pid}>
        <div className="pm2-consumer-title"><strong title={alias || row.name}>{alias || row.name}</strong>
          <span>{percentText(row.percent)}</span></div>
        <div className="pm2-consumer-meta"><span title={row.name}>{alias ? row.name + ' · ' : ''}PID {row.pid}</span>
          {(card.key === 'memory' || card.key === 'disk') && <span>{card.format(row.value)}</span>}</div>
        <div className="pm2-consumer-meter" aria-hidden="true"><i style={{ width: Math.min(row.percent, 100) + '%' }} /></div>
      </li>
    })}</ol> : <p>Nenhum processo com consumo registrado nesta amostra.</p>}
  </>
}

export function Pm2HostResources({ cards, consumers, processes, onDiskInspect, inspectMemoryRef }: {
  cards: ResourceCard[]; consumers?: Pm2Host['consumers']; processes: Pm2Process[]; onDiskInspect?: (open: boolean) => void; inspectMemoryRef: Ref<() => void>
}) {
  const panelId = useId()
  const root = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusMemory = useRef(false)
  const [view, setView] = useState<{ key: HostResource; pinned: boolean } | null>(null)
  const active = cards.find(card => card.key === view?.key)
  const inspectingDisk = view?.key === 'disk'
  useImperativeHandle(inspectMemoryRef, () => () => {
    focusMemory.current = true
    setView({ key: 'memory', pinned: true })
  }, [])
  useLayoutEffect(() => {
    if (focusMemory.current && view?.key === 'memory') {
      focusMemory.current = false
      heading.current?.focus()
    }
  }, [view])
  const rankTitle = active && (inspectingDisk && consumers?.disk?.basis === 'processIo'
    ? 'Processos por leitura e gravação (disco, rede e dispositivos)'
    : 'Processos por consumo de ' + names[active.key])
  useEffect(() => { onDiskInspect?.(inspectingDisk) }, [inspectingDisk, onDiskInspect])
  useEffect(() => () => onDiskInspect?.(false), [onDiskInspect])
  const close = useCallback((restoreFocus: boolean) => {
    if (restoreFocus) root.current?.querySelector<HTMLButtonElement>('.pm2-resource-button[aria-expanded="true"]')?.focus({ preventScroll: true })
    setView(null)
  }, [])
  useEffect(() => {
    if (!view) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog:modal, :popover-open')) return
      close(!!root.current?.contains(document.activeElement))
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [view, close])
  const preview = (key: HostResource) => setView(current => current?.pinned || current?.key === key ? current : { key, pinned: false })
  const toggle = (key: HostResource) => setView(current => current?.pinned && current.key === key ? null : { key, pinned: true })
  const leave = () => setView(current => current?.pinned ? current : null)
  return <section ref={root} className="pm2-host" aria-label="Recursos do computador"
    onPointerLeave={() => {
      if (document.activeElement?.closest('[data-resource]')?.getAttribute('data-resource') !== view?.key) leave()
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
          onFocus={() => preview(card.key)} title={pinned ? 'Fechar detalhes' : 'Fixar detalhes'}>
          {card.icon}<span>{card.title}</span>{pinned ? <Pin size={13} /> : <ChevronDown size={14} />}</button></h2>
        {card.body}
      </article>
    })}
    {active && <section className="pm2-rank" id={panelId} data-resource={active.key} aria-label={rankTitle || undefined}>
      <div className="pm2-rank-title"><h3 ref={heading} tabIndex={-1}>{rankTitle}</h3>
        {view?.pinned && <Pin size={13} aria-label="Fixado" />}
        <button type="button" className="icon-button" aria-label="Fechar detalhes do recurso" onClick={() => close(true)}><X size={14} /></button></div>
      <ConsumerList card={active} rank={consumers?.[active.key]} processes={processes} />
    </section>}
  </section>
}
