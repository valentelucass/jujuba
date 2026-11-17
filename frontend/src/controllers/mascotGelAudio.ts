export type GelEffect = 'throw' | 'slimeKick' | 'bounceOffWall'
type Bubble = [start: number, length: number, startHz: number, endHz: number, loudness: number, splash: number]

const recipes: Record<GelEffect, Bubble[]> = {
  throw: [
    [0, .21, 630, 153, .47, .57], [.119, .17, 150, 473, .52, .40],
    [.172, .083, 780, 320, .27, .58], [.227, .09, 525, 166, .16, .64],
  ],
  slimeKick: [
    [0, .17, 188, 63, .81, .39], [.009, .20, 860, 175, .54, .83],
    [.071, .098, 354, 126, .44, .28], [.130, .119, 214, 442, .28, .63],
  ],
  bounceOffWall: [
    [0, .155, 205, 57, .85, .51], [.007, .17, 780, 147, .52, .96],
    [.047, .106, 132, 434, .54, .39], [.091, .091, 576, 193, .33, .66],
    [.146, .112, 318, 112, .34, .56], [.205, .083, 490, 182, .22, .69],
    [.248, .086, 695, 210, .13, .66],
  ],
}

export function makeGelAudio(context: BaseAudioContext, effect: GelEffect) {
  const bubbles = recipes[effect]
  const duration = Math.max(...bubbles.map(([start, length]) => start + length))
  const rate = context.sampleRate
  const buffer = context.createBuffer(1, Math.ceil((duration + .012) * rate), rate)
  const wave = buffer.getChannelData(0)
  let seed = 1779033703

  for (const [start, length, startHz, endHz, loudness, splash] of bubbles) {
    const skip = Math.round(start * rate)
    const samples = Math.min(wave.length - skip, Math.round(length * rate))
    let phase = 0
    let wobble = 0
    let slowNoise = 0
    let wetNoise = 0
    for (let i = 0; i < samples; i++) {
      const t = i / samples
      const age = i / rate
      wobble += Math.PI * 2 * (16 + startHz * .019) / rate
      const frequency = startHz * (endHz / startHz) ** t * (1 + .105 * Math.sin(wobble))
      phase += Math.PI * 2 * frequency / rate
      const opening = Math.min(1, age / (start === 0 && effect !== 'throw' ? .004 : .014))
      const air = opening * (1 - t) ** 2.05
      const resonant = Math.sin(phase + .38 * Math.sin(phase * 1.14)) + .22 * Math.sin(phase * 2.07)

      seed = (Math.imul(seed, 1664525) + 1013904223) | 0
      const hiss = (seed >>> 0) / 2147483648 - 1
      slowNoise += .019 * (hiss - slowNoise)
      wetNoise += Math.min(.32, frequency * 18 / rate) * (hiss - wetNoise)
      const spray = (wetNoise - slowNoise) * (2.9 + 1.3 * Math.sin(wobble * .73))
      wave[skip + i] += air * loudness * ((1 - splash * .55) * resonant + spray * splash)
    }
  }

  for (let i = 0; i < wave.length; i++) wave[i] = Math.tanh(wave[i] * 1.15) * .88
  return buffer
}
