import { useCallback, useEffect, useRef, useState } from 'react'
import type { MascotMeetingKind } from '../models/flowMascot'

type Sound = MascotMeetingKind | 'click' | 'bounceOffWall' | 'blaster' | 'bow' | 'hit' | 'hatch'
export type SoundStyle = 'candy' | 'retro' | 'jelly' | 'silent'
type SoundSettings = { style: SoundStyle; volume: number }
type Note = [start: number, length: number, pitch: number, endPitch: number, emphasis?: number]

export const soundStyles: Record<SoundStyle, string> = {
  candy: 'Doce', retro: 'Retrô', jelly: 'Gelatina', silent: 'Silencioso',
}

const notes: Record<Sound, Note[]> = {
  click: [[0, .075, 660, 440], [.028, .07, 990, 770, .45]],
  kiss: [[0, .085, 520, 260], [.086, .065, 840, 560], [.165, .13, 1047, 1175, .38]],
  hug: [[0, .19, 392, 440], [.07, .22, 523, 587], [.14, .28, 660, 784, .65]],
  squeeze: [[0, .12, 300, 790], [.12, .14, 750, 390, .73]],
  look: [[0, .11, 440, 660], [.14, .15, 587, 770, .62]],
  dance: [[0, .11, 392, 440], [.09, .11, 523, 587], [.18, .11, 587, 660], [.27, .17, 784, 830]],
  play: [[0, .13, 450, 720], [.13, .16, 680, 410]],
  bounce: [[0, .12, 400, 220], [.13, .14, 510, 270, .55]],
  bounceOffWall: [[0, .11, 255, 110], [.045, .09, 570, 265, .38]],
  push: [[0, .17, 440, 140], [.05, .13, 270, 100, .54]],
  bump: [[0, .09, 380, 86], [.05, .16, 630, 380, .44]],
  blaster: [[0, .18, 1030, 210], [.025, .08, 435, 167, .56]],
  bow: [[0, .15, 290, 86], [.032, .145, 860, 1580, .38]],
  hit: [[0, .11, 220, 85], [.052, .13, 635, 345, .58]],
  hatch: [[0, .06, 245, 102], [.095, .12, 698, 790], [.18, .13, 880, 980], [.255, .24, 1175, 1320, .74]],
}

const storageKey = 'jujuba.assistant.sounds'
function readSoundSettings(): SoundSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (saved && Object.hasOwn(soundStyles, saved.style) && Number.isFinite(saved.volume)) {
      return { style: saved.style, volume: Math.max(0, Math.min(1, saved.volume)) }
    }
  } catch { /* As opções continuam funcionando durante a sessão. */ }
  return { style: 'candy', volume: .36 }
}

export function useMascotSound() {
  const [settings, setSettings] = useState(readSoundSettings)
  const current = useRef(settings)
  const audio = useRef<AudioContext | null>(null)
  const played = useRef<Partial<Record<Sound, number>>>({})
  const variation = useRef(0)
  current.current = settings

  useEffect(() => {
    function unlock() {
      if (current.current.style === 'silent' || !current.current.volume || !window.AudioContext) return
      try {
        audio.current ??= new AudioContext()
        if (audio.current.state === 'suspended') void audio.current.resume().catch(() => {})
      } catch { /* O dispositivo de áudio pode estar indisponível. */ }
    }
    window.addEventListener('pointerdown', unlock, true)
    window.addEventListener('keydown', unlock, true)
    return () => {
      window.removeEventListener('pointerdown', unlock, true)
      window.removeEventListener('keydown', unlock, true)
      if (audio.current && audio.current.state !== 'closed') void audio.current.close().catch(() => {})
      audio.current = null
    }
  }, [])

  const play = useCallback((sound: Sound) => {
    const context = audio.current
    const { style, volume } = current.current
    const now = performance.now()
    if (!context || context.state === 'closed' || style === 'silent' || !volume || now - (played.current[sound] ?? -Infinity) < 95) return
    played.current[sound] = now
    const tuning = [1, .95, 1.055][variation.current++ % 3] * (style === 'jelly' ? .72 : style === 'retro' ? 1.15 : 1)
    const base = context.currentTime
    for (const [offset, length, pitch, endPitch, emphasis = 1] of notes[sound]) {
      const start = base + offset
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = style === 'retro' ? 'square' : style === 'jelly' ? 'sine' : 'triangle'
      oscillator.frequency.setValueAtTime(pitch * tuning, start)
      oscillator.frequency.exponentialRampToValueAtTime(endPitch * tuning, start + length)
      gain.gain.setValueAtTime(.0001, start)
      gain.gain.exponentialRampToValueAtTime(.0001 + volume * emphasis * (style === 'retro' ? .06 : .12), start + .014)
      gain.gain.exponentialRampToValueAtTime(.0001, start + length)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(start)
      oscillator.stop(start + length)
    }
  }, [])

  function save(next: SoundSettings) {
    setSettings(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* A seleção continua ativa na janela. */ }
  }

  return { settings, save, play }
}
