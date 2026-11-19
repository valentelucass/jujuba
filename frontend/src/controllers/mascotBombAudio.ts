import { gooBombTiming } from '../models/mascotScene'

// Two rotor banks wind up and coast down together. Slightly different tooth
// counts give the siren its beating mechanical timbre.
const rotorPitch = [[0, 188], [.25, 560], [.46, 302], [.70, 615], [.85, 402], [1, 230]]
const echoTail = 3.9

export function playBombScore(context: BaseAudioContext, destination: AudioNode) {
  const start = context.currentTime
  const landing = start + gooBombTiming.landing / 1000
  const pull = start + gooBombTiming.pull / 1000
  const burst = start + gooBombTiming.burst / 1000
  const cut = burst - .145
  const duration = burst - start - .09
  const sources = new Set<AudioScheduledSourceNode>()
  const mix = context.createDynamicsCompressor()
  const output = context.createGain()
  mix.threshold.value = -8
  mix.knee.value = 6
  mix.ratio.value = 5
  mix.attack.value = .003
  mix.release.value = .2
  output.gain.value = .86
  mix.connect(output).connect(destination)

  function schedule(node: AudioScheduledSourceNode, when: number, end: number) {
    sources.add(node)
    node.onended = () => {
      node.disconnect()
      sources.delete(node)
      if (!sources.size) {
        mix.disconnect()
        output.disconnect()
      }
    }
    node.start(when)
    node.stop(end)
  }

  const horn = context.createPeriodicWave(new Float32Array(9),
    Float32Array.from([0, 1, .44, .26, .19, .15, .10, .058, .036]))
  for (const [ratio, level] of [[1, .16], [1.203, .095]]) {
    const rotor = context.createOscillator()
    const amplitude = context.createGain()
    rotor.setPeriodicWave(horn)
    // Smooth acceleration at the ends of each sweep avoids an electronic trill.
    const curve = new Float32Array(161)
    let section = 0
    for (let i = 0; i < curve.length; i++) {
      const t = i / (curve.length - 1)
      while (t > rotorPitch[section + 1][0]) section++
      const [t0, f0] = rotorPitch[section]
      const [t1, f1] = rotorPitch[section + 1]
      const u = (t - t0) / (t1 - t0)
      curve[i] = ratio * (f0 + (f1 - f0) * u * u * (3 - 2 * u))
    }
    rotor.frequency.setValueCurveAtTime(curve, start, duration)
    amplitude.gain.setValueAtTime(0, start)
    amplitude.gain.linearRampToValueAtTime(level, start + duration * .20)
    amplitude.gain.linearRampToValueAtTime(level * .57, start + duration * .46)
    amplitude.gain.linearRampToValueAtTime(level, start + duration * .70)
    amplitude.gain.linearRampToValueAtTime(0, cut)
    rotor.connect(amplitude).connect(mix)
    schedule(rotor, start, cut)
  }

  const air = context.createBuffer(1, Math.ceil(context.sampleRate * 1.79), context.sampleRate)
  const samples = air.getChannelData(0)
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1

  function pressure(when: number, length: number, pitch: number, floor: number, level: number) {
    const driver = context.createOscillator()
    const envelope = context.createGain()
    driver.frequency.setValueAtTime(pitch, when)
    driver.frequency.exponentialRampToValueAtTime(floor, when + length * .36)
    envelope.gain.setValueAtTime(0, when)
    envelope.gain.linearRampToValueAtTime(level, when + .008)
    envelope.gain.exponentialRampToValueAtTime(.0001, when + length)
    driver.connect(envelope).connect(mix)
    schedule(driver, when, when + length)
  }

  function noise(when: number, length: number, high: number, low: number, level: number, swell: number) {
    const gust = context.createBufferSource()
    const tone = context.createBiquadFilter()
    const envelope = context.createGain()
    gust.buffer = air
    gust.loop = length > air.duration
    tone.type = 'lowpass'
    tone.Q.value = .72
    tone.frequency.setValueAtTime(high, when)
    tone.frequency.exponentialRampToValueAtTime(low, when + length)
    envelope.gain.setValueAtTime(0, when)
    envelope.gain.linearRampToValueAtTime(level, when + swell)
    envelope.gain.exponentialRampToValueAtTime(level * .25, when + length * .53)
    envelope.gain.exponentialRampToValueAtTime(.0001, when + length)
    gust.connect(tone).connect(envelope).connect(mix)
    schedule(gust, when, when + length)
  }

  pressure(landing, .32, 104, 54, .32)
  noise(landing, .19, 1600, 220, .46, .003)

  // An accelerating breath gathers during the pull and breaks before the blast.
  const intake = context.createBufferSource()
  const throat = context.createBiquadFilter()
  const breath = context.createGain()
  intake.buffer = air
  intake.loop = true
  const swell = pull + (cut - pull) * .66
  throat.type = 'bandpass'
  throat.Q.value = .86
  throat.frequency.setValueAtTime(240, pull)
  throat.frequency.exponentialRampToValueAtTime(770, swell)
  throat.frequency.exponentialRampToValueAtTime(2400, cut - .025)
  breath.gain.setValueAtTime(.001, pull)
  breath.gain.exponentialRampToValueAtTime(.16, swell)
  breath.gain.exponentialRampToValueAtTime(.52, cut - .025)
  breath.gain.linearRampToValueAtTime(0, cut)
  intake.connect(throat).connect(breath).connect(mix)
  schedule(intake, pull, cut)

  pressure(burst, 1.15, 81, 37, .57)
  noise(burst, .28, 4700, 560, .87, .004)
  noise(burst + .027, 1.9, 1450, 110, .91, .035)
  // Stagger two darker returns so the initial transient recedes into rolling thunder.
  noise(burst + .29, 2.45, 505, 80, .87, .15)
  noise(burst + .74, echoTail - .74, 310, 69, .76, .21)

  return () => {
    if (!sources.size) return
    const now = context.currentTime
    output.gain.cancelScheduledValues(now)
    output.gain.setTargetAtTime(0, now, .007)
    for (const source of sources) source.stop(now + .035)
  }
}
