import { useCallback, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { sql } from '../controllers/api'
import { useRemote } from '../controllers/useRemote'
import type { ColumnStorage, TableStorage } from '../models/dashboard'
import type { Scope } from '../models/sql'
import { Failure } from './States'

const integer = new Intl.NumberFormat('pt-BR')
const compact = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB']
const reasons: Record<string, string> = {
  virtual: 'Calculada sem persistência',
  columnSet: 'Conjunto de colunas esparsas',
  encrypted: 'Coluna criptografada',
  masked: 'Coluna mascarada',
  denied: 'Sem permissão de leitura',
  clr: 'Tipo CLR sem medição',
  hidden: 'Coluna interna',
}

export function exactBytes(value: string) {
  return integer.format(BigInt(value)) + ' B'
}

export function storageSize(value: string | bigint) {
  let size = Number(value)
  let index = 0
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index++ }
  return compact.format(size) + ' ' + units[index]
}

export function StorageColumns({ database, session, table }: Scope & { table: TableStorage }) {
  const [fullScan, setFullScan] = useState(false)
  const [revision, setRevision] = useState(0)
  const load = useCallback(() => sql.dashboardColumnStorage(
    { database, session, tableId: table.id }, fullScan,
  ), [database, session, table.id, fullScan, revision])
  const result = useRemote(load)
  const retry = () => setRevision(value => value + 1)
  return <section className="storage-columns" id={'storage-detail-' + table.id} aria-label={'Colunas de ' + table.schema + '.' + table.name}>
    <h3>Armazenamento por coluna</h3>
    <p>Espaço físico da tabela com índices · {exactBytes(table.usedBytes)} usados · {exactBytes(table.reservedBytes)} reservados</p>
    {result.status === 'ready' ? <ColumnMeasurements data={result.data} retry={retry} measureAll={() => setFullScan(true)} />
      : result.status === 'error' ? <>
        <Failure error={result.error} retry={retry} />
        {fullScan && <button className="button" onClick={() => setFullScan(false)}>Voltar à leitura rápida</button>}
      </> : <p role="status" className="storage-progress"><LoaderCircle className="spin" size={15} />
        {fullScan ? 'Medindo todas as linhas…' : 'Lendo as colunas…'}</p>}
  </section>
}

function ColumnMeasurements({ data, retry, measureAll }: {
  data: ColumnStorage; retry: () => void; measureAll: () => void
}) {
  const { method, columns, measuredRows, catalogRows } = data
  const count = BigInt(measuredRows)
  const sampled = method === 'sample'
  const partial = sampled || method === 'limited'
  const tableRows = catalogRows === null ? 0n : BigInt(catalogRows)
  const estimate = sampled && count > 0n && tableRows > 0n
  const summary = method === 'unavailable' ? 'Nenhuma coluna disponível para medição.'
    : method === 'full' ? 'Leitura completa · ' + integer.format(count) + ' linhas lidas'
    : (sampled ? 'Amostra por páginas' : 'Leitura limitada') + ' · ' + integer.format(count) + ' linhas lidas'
      + (catalogRows !== null ? ' · ' + integer.format(BigInt(catalogRows)) + ' linhas estimadas na tabela' : '')
  return <>
    <p className="storage-summary" role="status">{summary}</p>
    <p>Os tamanhos por coluna somam os bytes dos valores. Índices, compressão e estruturas de página afetam o espaço físico da tabela.</p>
    {sampled && count === 0n && <p>A amostra veio vazia. <button className="button" onClick={retry}>Repetir amostra</button></p>}
    <div className="storage-column-scroll"><table aria-label="Tamanho dos valores por coluna">
      <thead><tr><th scope="col">Coluna</th><th scope="col">Tipo SQL</th>
        <th scope="col">{partial ? 'Medido nas linhas lidas' : 'Tamanho medido'}</th>
        {estimate && <th scope="col">Estimado na tabela</th>}</tr></thead>
      <tbody>{columns.map(column => <tr key={column.name}>
        <th scope="row">{column.name}</th><td><code>{column.dataType}</code></td>
        <td>{column.measuredBytes !== null
          ? <>{exactBytes(column.measuredBytes)}{BigInt(column.measuredBytes) >= 1024n && <small>{storageSize(column.measuredBytes)}</small>}</>
          : (column.reason && reasons[column.reason]) || 'Sem medição'}</td>
        {estimate && <td>{column.measuredBytes !== null && BigInt(column.measuredBytes) > 0n
          ? '≈ ' + storageSize(BigInt(column.measuredBytes) * tableRows / count) : '—'}</td>}
      </tr>)}</tbody>
    </table></div>
    {partial && <div className="storage-full"><button className="button" onClick={measureAll}>Medir todas as linhas</button>
      <span>Faz uma leitura completa e pode aumentar a carga do banco.</span></div>}
  </>
}
