import { useCallback, useEffect, useRef, useState } from 'react'
import type { MascotMeetingKind } from '../models/flowMascot'
import { makeGelAudio, type GelEffect } from './mascotGelAudio'

type Sound = MascotMeetingKind | GelEffect | 'click' | 'blaster' | 'bow' | 'hit' | 'hatch' | 'ricochet'
type SoundSettings = { muted: boolean; volume: number }
type Note = [start: number, length: number, pitch: number, endPitch: number, emphasis?: number]
type BowCreak = { noise: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode }

const notes: Record<Exclude<Sound, GelEffect>, Note[]> = {
  click: [[0, .075, 660, 440], [.028, .07, 990, 770, .45]],
  kiss: [[0, .085, 520, 260], [.086, .065, 840, 560], [.165, .13, 1047, 1175, .38]],
  hug: [[0, .19, 392, 440], [.07, .22, 523, 587], [.14, .28, 660, 784, .65]],
  squeeze: [[0, .12, 300, 790], [.12, .14, 750, 390, .73]],
  look: [[0, .11, 440, 660], [.14, .15, 587, 770, .62]],
  dance: [[0, .11, 392, 440], [.09, .11, 523, 587], [.18, .11, 587, 660], [.27, .17, 784, 830]],
  play: [[0, .13, 450, 720], [.13, .16, 680, 410]],
  bounce: [[0, .20, 355, 104], [.042, .12, 145, 458, .7], [.14, .15, 415, 173, .48]],
  push: [[0, .17, 440, 140], [.05, .13, 270, 100, .54]],
  bump: [[0, .09, 380, 86], [.05, .16, 630, 380, .44]],
  blaster: [[0, .18, 1030, 210], [.025, .08, 435, 167, .56]],
  bow: [[0, .048, 520, 130], [.020, .18, 1080, 350, .56], [.066, .15, 790, 110, .31]],
  hit: [[0, .11, 220, 85], [.052, .13, 635, 345, .58]],
  hatch: [[0, .06, 245, 102], [.095, .12, 698, 790], [.18, .13, 880, 980], [.255, .24, 1175, 1320, .74]],
  ricochet: [[0, .09, 425, 208], [.021, .16, 310, 830, .55]],
}

const wetSounds: Partial<Record<Sound, number>> = {
  kiss: .11, squeeze: .16, bounce: .22,
  push: .17, bump: .23, hit: .19, blaster: .21, bow: .15, ricochet: .13,
}
const storageKey = 'jujuba.assistant.sounds'
function readSoundSettings(): SoundSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (saved && Number.isFinite(saved.volume)) {
      return { muted: typeof saved.muted === 'boolean' ? saved.muted : saved.style === 'silent',
        volume: Math.max(0, Math.min(1, saved.volume)) }
    }
  } catch { /* As opções continuam funcionando durante a sessão. */ }
  return { muted: false, volume: .43 }
}

export function useMascotSound() {
  const [settings, setSettings] = useState(readSoundSettings)
  const current = useRef(settings)
  const audio = useRef<{ context: AudioContext; master: GainNode; noise: AudioBuffer; gel: Map<GelEffect, AudioBuffer> } | null>(null)
  const bow = useRef<BowCreak | null>(null)
  const played = useRef<Partial<Record<Sound, number>>>({})
  const variation = useRef(0)
  current.current = settings

  useEffect(() => {
    function unlock() {
      if (current.current.muted || !current.current.volume || !window.AudioContext) return
      try {
        if (!audio.current) {
          const context = new AudioContext()
          const master = context.createGain()
          master.gain.value = current.current.volume
          master.connect(context.destination)
          const noise = context.createBuffer(1, Math.ceil(context.sampleRate * .30), context.sampleRate)
          const samples = noise.getChannelData(0)
          for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
          audio.current = { context, master, noise, gel: new Map() }
        }
        if (audio.current.context.state === 'suspended') void audio.current.context.resume().catch(() => {})
      } catch { /* O dispositivo de áudio pode estar indisponível. */ }
    }
    window.addEventListener('pointerdown', unlock, true)
    window.addEventListener('keydown', unlock, true)
    return () => {
      window.removeEventListener('pointerdown', unlock, true)
      window.removeEventListener('keydown', unlock, true)
      if (audio.current && audio.current.context.state !== 'closed') void audio.current.context.close().catch(() => {})
      bow.current = null
      audio.current = null
    }
  }, [])

  const tension = useCallback((power: number) => {
    const active = audio.current
    if (!active) return
    const { context, master, noise } = active
    const now = context.currentTime
    if (power <= .023 || current.current.muted || !current.current.volume) {
      if (bow.current) {
        bow.current.gain.gain.setTargetAtTime(.0001, now, .015)
        bow.current.noise.stop(now + .065)
        bow.current = null
      }
      return
    }
    if (!bow.current) {
      const source = context.createBufferSource()
      const filter = context.createBiquadFilter()
      const gain = context.createGain()
      source.buffer = noise
      source.loop = true
      filter.type = 'bandpass'
      filter.Q.value = 6.5
      gain.gain.value = .0001
      source.connect(filter).connect(gain).connect(master)
      source.start(now)
      bow.current = { noise: source, filter, gain }
    }
    const creak = bow.current
    creak.filter.frequency.setTargetAtTime(330 + 750 * power, now, .048)
    creak.noise.playbackRate.setTargetAtTime(.58 + power * 1.12, now, .04)
    creak.gain.gain.cancelScheduledValues(now)
    creak.gain.gain.setTargetAtTime(Math.min(.78, .2 + power * .52), now, .028)
    creak.gain.gain.setTargetAtTime(.06 + power * .14, now + .15, .085)
  }, [])

  const play = useCallback((sound: Sound, intensity = 1) => {
    const active = audio.current
    const { muted, volume } = current.current
    const now = performance.now()
    if (!active || active.context.state === 'closed' || muted || !volume || now - (played.current[sound] ?? -Infinity) < 95) return
    played.current[sound] = now
    const { context, master, noise, gel } = active
    const variationRate = [1, .92, 1.08][variation.current++ % 3]
    if (sound === 'throw' || sound === 'slimeKick' || sound === 'bounceOffWall') {
      const buffer = gel.get(sound) ?? makeGelAudio(context, sound)
      gel.set(sound, buffer)
      const source = context.createBufferSource()
      const gain = context.createGain()
      source.buffer = buffer
      source.playbackRate.value = variationRate * (1.06 - Math.min(1.35, intensity) * .11)
      gain.gain.value = .8 * Math.min(intensity, 1.20)
      source.connect(gain).connect(master)
      source.start()
      return
    }

    const tuning = variationRate * .8
    const base = context.currentTime
    for (const [offset, length, pitch, endPitch, emphasis = 1] of notes[sound]) {
      const start = base + offset
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = pitch > 600 ? 'sine' : 'triangle'
      oscillator.frequency.setValueAtTime(pitch * tuning, start)
      oscillator.frequency.exponentialRampToValueAtTime(endPitch * tuning, start + length)
      gain.gain.setValueAtTime(.0001, start)
      gain.gain.exponentialRampToValueAtTime(.0001 + intensity * emphasis * .16, start + .014)
      gain.gain.exponentialRampToValueAtTime(.0001, start + length)
      oscillator.connect(gain)
      gain.connect(master)
      oscillator.start(start)
      oscillator.stop(start + length)
    }
    const wet = wetSounds[sound]
    if (wet) {
      const source = context.createBufferSource()
      const filter = context.createBiquadFilter()
      const gain = context.createGain()
      const end = base + wet
      source.buffer = noise
      filter.type = 'bandpass'
      filter.Q.value = 4.3
      filter.frequency.setValueAtTime(980 * tuning, base)
      filter.frequency.exponentialRampToValueAtTime(220 * tuning, base + wet * .27)
      filter.frequency.exponentialRampToValueAtTime(635 * tuning, end)
      gain.gain.setValueAtTime(.0001, base)
      gain.gain.exponentialRampToValueAtTime(.0001 + .54 * intensity, base + .017)
      gain.gain.exponentialRampToValueAtTime(.0001, end)
      source.connect(filter).connect(gain).connect(master)
      source.start(base)
      source.stop(end)
    }
  }, [])

  function save(next: SoundSettings) {
    current.current = next
    if (audio.current) {
      const { context, master } = audio.current
      master.gain.setTargetAtTime(next.muted ? 0 : next.volume, context.currentTime, .025)
    }
    setSettings(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* A seleção continua ativa na janela. */ }
  }

  return { settings, save, play, tension }
}
