import { useCallback, useEffect, useRef, useState } from 'react'
import { appError, call } from './api'
import type { HostProcessUsage } from '../models/pm2'

const reasons = {
  pm2: 'PM2 ou subprocesso', infrastructure: 'Serviço, banco ou dependência', sessionOrWindow: 'Sessão ou janela fora dos critérios',
  unverified: 'Verificação inconclusiva', active: 'Atividade recente, pouco uso de RAM ou ajuste recente', noPressure: 'Sem pressão de memória confirmada',
  idleUtility: 'Utilitário descartável ocioso', idleApp: 'Aplicativo ocioso sob pressão de memória', idleNotice: 'Janela informativa ociosa',
}
const policies = { preserve: 'Preservar', trim: 'Pode reduzir RAM', close: 'Pode fechar' }
interface Evaluation { pid: number; name: string; started: string | null; policy: keyof typeof policies; reason: keyof typeof reasons }
interface Analysis { sampledAt: number; scannedCount: number; memoryPressure: boolean | null; processes: Evaluation[] }

export const executable = (name: string) => (name.split(/[\\/]/).at(-1) ?? name).trim().replace(/\.exe$/i, '').toLocaleLowerCase()

export function assessment(row: HostProcessUsage, evaluated: Map<number, Evaluation>) {
  const item = evaluated.get(row.pid)
  if (!item || executable(item.name) !== executable(row.name) || (row.started && item.started && row.started !== item.started))
    return { label: 'Sem parecer atual', detail: 'PID ou identidade ausente na última análise.' }
  if ((!row.started || !item.started) && item.policy !== 'preserve')
    return { label: 'Sem parecer atual', detail: 'Identidade da instância não confirmada.' }
  return { label: policies[item.policy], detail: reasons[item.reason] }
}

export function useHostAnalysis() {
  const [data, setData] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const completedAt = useRef(0)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  const analyze = useCallback(async (force = true) => {
    if (busy.current || (!force && Date.now() - completedAt.current < 30000)) return
    busy.current = true
    const token = generation.current
    setLoading(true)
    setError('')
    try {
      const next = await call<Analysis>('optimizer_analyze')
      if (token === generation.current) { setData(next); completedAt.current = Date.now() }
    } catch (failure) {
      if (token === generation.current) { setData(null); completedAt.current = 0; setError(appError(failure).message) }
    } finally {
      busy.current = false
      if (token === generation.current) setLoading(false)
    }
  }, [])
  return { data, error, loading, analyze }
}
