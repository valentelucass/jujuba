export type GelEffect = 'throw' | 'slimeKick' | 'bounceOffWall'

// Damped air bubbles and filtered, pulsed noise form the wet impact.
export function makeGelAudio(context: BaseAudioContext, effect: GelEffect) {
  const throwing = effect === 'throw'
  const duration = throwing ? .39 : effect === 'slimeKick' ? .34 : .46
  const rate = context.sampleRate
  const buffer = context.createBuffer(1, Math.ceil(duration * rate), rate)
  const wave = buffer.getChannelData(0)
  let seed = 1779033703
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0
    return (seed >>> 0) / 4294967296
  }

  let body = 0
  let film = 0
  let spray = 0
  for (let i = 0; i < wave.length; i++) {
    const time = i / rate
    const t = time / duration
    const noise = random() * 2 - 1
    const squeeze = throwing ? Math.sin(Math.PI * t) ** .65 : Math.exp(-time * 13)
    const suction = .5 + .5 * Math.sin(2 * Math.PI * (22 * time + 32 * time * time))
    body += .014 * (noise - body)
    film += (.07 + .18 * squeeze) * (noise - film)
    spray += .45 * (noise - spray)
    const attack = Math.min(1, time / (throwing ? .026 : .0025))
    const tail = Math.max(0, 1 - t) ** 1.8
    wave[i] = attack * tail * squeeze * (body * 1.7 + (film - body) * 1.45 * (.38 + suction) + (spray - film) * .12)
  }

  // Very short resonances avoid a continuous pitched sweep.
  const count = throwing ? 15 : 24
  for (let bubble = 0; bubble < count; bubble++) {
    const delay = (throwing ? .045 : .008) + random() ** 1.35 * (duration - .09)
    const length = .009 + random() * .026
    const frequency = 160 + random() ** 1.55 * 1500
    const amplitude = (.12 + random() * .24) * (1 - delay / duration)
    const skip = Math.floor(delay * rate)
    const countSamples = Math.min(wave.length - skip, Math.ceil(length * rate))
    let phase = 0
    for (let i = 0; i < countSamples; i++) {
      const time = i / rate
      const t = time / length
      phase += Math.PI * 2 * frequency * (1 - .23 * t) / rate
      const envelope = Math.min(1, time / .0012) * Math.exp(-t * 5)
      wave[skip + i] += amplitude * envelope * (Math.sin(phase) + (random() - .5) * 1.35)
    }
  }
  for (let i = 0; i < wave.length; i++) wave[i] = Math.tanh(wave[i] * 2.1) * .86
  return buffer
}
