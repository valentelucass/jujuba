import { useCallback, useId, useState, type ReactNode } from 'react'
import { appError, sql } from '../controllers/api'
import { useRemote } from '../controllers/useRemote'
import type { RetentionCatalog, RetentionMode, RetentionPreview } from '../models/retention'
import type { AppError, Scope } from '../models/sql'
import { Failure, Loading } from './States'
import './retention.css'

const count = new Intl.NumberFormat('pt-BR')
const date = (iso: string) => iso.split('-').reverse().join('/')
const index = (iso: string) => Date.parse(iso + 'T00:00:00Z') / 86400000
const names = { kept: 'Guardado', due: 'Aguarda limpeza', removed: 'Apagado', held: 'Protegido', empty: 'Sem captura' } as const
type Kind = keyof typeof names
type Catalog = Extract<RetentionCatalog, {available:true}>
type Preview = Extract<RetentionPreview, {available:true}>
const entityName = (name: string) => name === 'OCORRENCIAS' ? 'Ocorrências' : name.replaceAll('_', ' ')

function RetentionField({ label, help, children }: {
  label: string; help: string; children: (attributes: {id: string; 'aria-describedby': string}) => ReactNode
}) {
  const id = useId()
  const hint = id + '-ajuda'
  const [dismissed, setDismissed] = useState(false)
  function position(field: HTMLElement) {
    setDismissed(false)
    const area = field.closest('.dashboard-body')?.getBoundingClientRect()
    if (!area) return
    const box = field.getBoundingClientRect()
    const width = Math.min(240, area.width - 24)
    const left = Math.max(area.left + 6, Math.min(box.left, area.right - width - 12))
    field.style.setProperty('--help-width', width + 'px')
    field.style.setProperty('--help-left', (left - box.left) + 'px')
    field.dataset.above = String(area.bottom - box.bottom < 100 && box.top - area.top > 100)
  }
  return <div className="toolbar-item retention-field" data-dismissed={dismissed || undefined}
    onPointerEnter={e=>position(e.currentTarget)} onFocus={e=>position(e.currentTarget)}
    onKeyDown={e=>{if (e.key === 'Escape') setDismissed(true)}}>
    <label htmlFor={id}>{label}</label>
    {children({id, 'aria-describedby':hint})}
    <span className="toolbar-tip" role="tooltip" id={hint}><strong>{label}</strong>{help}</span>
  </div>
}

function removedVolume(days: Preview['days']) {
  let total = 0n
  for (const day of days) {
    if (!day.removed && day.removedRows === 0) continue
    if (typeof day.removedBytes !== 'string' || !/^\d+$/.test(day.removedBytes)) return null
    total += BigInt(day.removedBytes)
  }
  if (total > 0n && total < 10_000_000n) return '< 0,01 GB'
  return (Number(total) / 1_000_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' GB'
}

function Timeline({ data }: { data: Preview }) {
  if (!data.days.length) return <p>Nenhuma captura registrada para esta entidade.</p>
  const today = index(data.today)
  const first = index(data.days[0].day)
  const last = Math.max(today, index(data.days[data.days.length - 1].day))
  const segments: {kind: Kind; length: number; start: number}[] = []
  const totals: Partial<Record<Kind, number>> = {}
  function append(kind: Kind, from: number, length: number) {
    if (length <= 0) return
    totals[kind] = (totals[kind] ?? 0) + length
    const previous = segments.at(-1)
    if (previous?.kind === kind) previous.length += length
    else segments.push({kind, length, start:from})
  }
  let next = first
  for (const item of data.days) {
    const d = index(item.day)
    append('empty', next, d-next)
    const kind = item.removed ? 'removed' : item.held ? 'held' : data.cutoff && item.day < data.cutoff ? 'due' : 'kept'
    append(kind, d, 1)
    next = d+1
  }
  append('empty',next,last-next+1)
  const volume = totals.removed ? removedVolume(data.days) : null
  return <figure className="retention-timeline">
    <div className="retention-scale"><span>Passado · {date(data.days[0].day)}</span><span>Hoje · {date(data.today)}</span></div>
    <div className="retention-rail" aria-hidden="true">{segments.map(s => <i key={s.start}
      data-kind={s.kind} style={{ width: (100*s.length/(last-first+1))+'%' }} />)}</div>
    <figcaption>{(Object.keys(totals) as Kind[]).map(kind => <span key={kind}><i data-kind={kind} />
      {names[kind]} · {count.format(totals[kind]!)} {totals[kind] === 1 ? 'dia' : 'dias'}
      {kind === 'removed' && <span title="Soma dos valores das linhas apagadas na origem, no Performance e no controle das capturas. Cada GB corresponde a 1 bilhão de bytes."> · {volume ?? 'Volume ainda não medido'}</span>}
    </span>)}</figcaption>
  </figure>
}

function Rule({ scope, catalog, selected, refresh, onSaved }: {
  scope: Scope; catalog: Catalog; selected: string; refresh: () => void; onSaved: () => void
}) {
  const isDefault = selected === '*'
  const entity = catalog.entities.find(x => x.name === selected)
  const currentMode = isDefault ? (catalog.defaultDays ? 'own' : 'keep') : entity?.mode ?? 'inherit'
  const currentDays = (isDefault ? catalog.defaultDays : entity?.days) ?? catalog.defaultDays ?? 90
  const [mode,setMode] = useState<RetentionMode>(currentMode)
  const [days,setDays] = useState(String(currentDays))
  const effective = mode === 'keep' ? 0 : mode === 'inherit' ? catalog.defaultDays ?? 0 : Number(days)
  const valid = Number.isInteger(effective) && effective >= (mode === 'own' ? 1 : 0) && effective <= 2147483647
  const [query,setQuery] = useState({ key:0, days:effective, mode:currentMode as RetentionMode })
  const [review,setReview] = useState(false)
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState<AppError|null>(null)
  const {database,session} = scope
  const load = useCallback(() => sql.retentionPreview({database,session},selected,query.days),[database,session,selected,query])
  const preview = useRemote(load)
  const data = preview.status === 'ready' && preview.data.available ? preview.data : null
  const fresh = data && valid && query.mode === mode && effective === query.days && data.revision === catalog.revision
  const canEdit = catalog.canConfigure && (isDefault || entity?.supported)
  const dirty = mode !== currentMode || (mode === 'own' && Number(days) !== currentDays)
  const expired = data?.days.filter(d => !d.removed && !d.held && data.cutoff && d.day < data.cutoff) ?? []
  const pending = expired.reduce((n,d) => n + d.sourceRows, 0)
  const latest = expired.reduce((n,d) => n + d.currentRows, 0)
  async function apply() {
    if (!fresh || !review || !canEdit || !dirty || saving) return
    setSaving(true); setError(null)
    try {
      const reply = await sql.retentionConfigure({database,session},selected,mode,mode === 'own' ? effective : 0,catalog.revision)
      if (!reply.available) throw new Error('O serviço de retenção mudou. Atualize o painel.')
      onSaved()
    } catch (e) { setError(appError(e)); setReview(false) }
    finally { setSaving(false) }
  }
  return <>
    <RetentionField label="Regra" help={isDefault ? 'Escolha se o banco conserva todo o histórico ou utiliza um prazo para as entidades que seguem o padrão.' : 'Escolha se a entidade segue o padrão do banco, usa um prazo próprio ou conserva todo o histórico.'}>
      {attrs=><select {...attrs} value={mode} disabled={saving} onChange={e=>{setMode(e.target.value as RetentionMode);setReview(false)}}>
        {!isDefault && <option value="inherit">Usar padrão do banco</option>}<option value="own">Prazo próprio</option><option value="keep">Conservar histórico</option>
      </select>}
    </RetentionField>
    {mode === 'own' && <RetentionField label="Prazo em dias" help="Quantidade de dias corridos que ficam guardados, contando hoje. Com 90 dias, ficam hoje e os 89 dias anteriores.">
      {attrs=><input {...attrs} type="number" min="1" max="2147483647" step="1" value={days} disabled={saving}
        onChange={e=>{setDays(e.target.value);setReview(false)}} />}
    </RetentionField>}
    <button className="button" disabled={!valid || saving} onClick={()=>{setError(null);setReview(false);setQuery(q=>({key:q.key+1,days:effective,mode}))}}>Ver prévia</button>
    <div className="retention-result">
      {isDefault && <p>O padrão vale para as entidades habilitadas que usam a regra do banco.</p>}
      {!isDefault && !entity?.supported && <p>Prévia disponível. A limpeza desta entidade depende da integração das tabelas que a utilizam.</p>}
      {preview.status === 'loading' && <Loading />}
      {preview.status === 'error' && <Failure error={preview.error} retry={refresh} />}
      {data && <><Timeline data={data} />
        <p aria-live="polite">{!fresh ? 'Atualize a prévia antes de salvar.' :
          data.cutoff ? 'Corte em '+date(data.cutoff)+'. '+count.format(latest)+' registros vigentes e '+count.format(pending)+' registros de origem, contando as versões anteriores, aguardam limpeza.' :
            'A regra conserva o histórico.'}</p></>}
      {canEdit && dirty && fresh && !review && <button className="button" onClick={()=>setReview(true)}>Revisar alteração</button>}
      {review && fresh && <div className="retention-confirm" role="group" aria-label="Confirmar regra de retenção">
        <p>{database} · {isDefault ? 'Padrão do banco' : entityName(selected)} · {effective ? effective+' dias. As próximas rodadas arquivam e removem os dados vencidos.' : 'Conservar o histórico disponível.'}</p>
        <button className="button" disabled={saving} onClick={apply}>Confirmar regra</button>
        <button className="button" disabled={saving} onClick={()=>setReview(false)}>Cancelar</button>
      </div>}
      {error && <Failure error={error} retry={refresh} />}
    </div>
  </>
}

export function RetentionPanel({database,session}: Scope) {
  const [open,setOpen] = useState(false)
  const [revision,setRevision] = useState(0)
  const [selected,setSelected] = useState('OCORRENCIAS')
  const [saved,setSaved] = useState(false)
  const refresh = () => setRevision(x=>x+1)
  const load = useCallback(()=>sql.retentionCatalog({database,session}),[database,session,revision])
  const catalog = useRemote(open ? load : null)

  const data = catalog.status === 'ready' && catalog.data.available ? catalog.data : null
  const name = data?.entities.some(e=>e.name===selected) || selected==='*' ? selected : data?.entities[0]?.name ?? '*'
  return <details className="dashboard-panel retention-panel" onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>Retenção por entidade</summary>
    {open && <div className="retention-content">
      {catalog.status === 'loading' && <Loading />}
      {catalog.status === 'error' && <Failure error={catalog.error} retry={refresh} />}
      {catalog.status === 'ready' && !catalog.data.available && <p>O banco selecionado ainda não disponibiliza o serviço de retenção para esta conexão.</p>}
      {data && <div className="retention-fields">
        <RetentionField label="Entidade" help="Grupo de dados que você quer consultar, como Ocorrências ou Coletas. A linha do tempo mostra o histórico do grupo escolhido.">
          {attrs=><select {...attrs} value={name} onChange={e=>{setSelected(e.target.value);setSaved(false)}}>
            {data.entities.map(x=><option key={x.name} value={x.name}>{entityName(x.name)}</option>)}<option value="*">Padrão do banco</option>
          </select>}
        </RetentionField>
        <button className="button" onClick={refresh}>Atualizar leitura</button>
        <Rule key={name+'/'+data.revision+'/'+revision} scope={{database,session}} catalog={data} selected={name}
          refresh={refresh} onSaved={()=>{setSaved(true);refresh()}} />
      </div>}
      {data && saved && <p role="status">Regra salva no banco.</p>}
    </div>}
  </details>
}
