import { useEffect, useRef, useState } from 'react'
import type { Pm2Process } from '../models/pm2'

interface Appearance { favorite?: true; color?: string }
const storageKey = 'jujuba.pm2.organizacao.v1'
const hex = /^#[\da-f]{6}$/i

export function processKey(p: Pm2Process) {
  const path = (value: string | null) => value?.replaceAll('/', '\\').toLowerCase() || ''
  const fallback = p.script || p.cwd ? null : [p.pid, p.startedAt]
  return JSON.stringify([p.namespace, p.name, p.id, p.mode, path(p.cwd), path(p.script), fallback])
}

function readAppearance(): Map<string, Appearance> {
  const result = new Map<string, Appearance>()
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(entries)) return result
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) continue
      const [key, value] = entry
      if (typeof key !== 'string' || !value || typeof value !== 'object') continue
      const appearance: Appearance = {}
      if (value.favorite === true) appearance.favorite = true
      if (typeof value.color === 'string' && hex.test(value.color)) appearance.color = value.color
      if (appearance.favorite || appearance.color) result.set(key, appearance)
    }
  } catch { /* Preferences are optional when storage is unavailable. */ }
  return result
}

export function usePm2Organization() {
  const [appearance, setAppearance] = useState(readAppearance)
  const current = useRef(appearance)
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return
      current.current = readAppearance()
      setAppearance(current.current)
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  function update(keys: string[], change: (value: Appearance) => Appearance) {
    const next = new Map(current.current)
    for (const key of keys) {
      const value = change(next.get(key) ?? {})
      if (value.favorite || value.color) next.set(key, value)
      else next.delete(key)
    }
    current.current = next
    setAppearance(next)
    try { localStorage.setItem(storageKey, JSON.stringify([...next])) } catch { /* Keep the in-memory settings. */ }
  }
  return {
    appearance,
    toggleFavorite: (key: string) => update([key], (v) => ({ ...v, favorite: v.favorite ? undefined : true })),
    colorRows: (keys: string[], color?: string) => {
      if (!color || hex.test(color)) update(keys, (v) => ({ ...v, color }))
    },
  }
}
