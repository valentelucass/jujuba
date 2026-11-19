export const mascotColors = [
  { name: 'Rosa original', value: '#df188d' },
  { name: 'Coral', value: '#ff695d' },
  { name: 'Manga', value: '#f4af33' },
  { name: 'Menta', value: '#32c89a' },
  { name: 'Azul', value: '#378ddf' },
  { name: 'Violeta', value: '#9b6ce0' },
] as const

export const originalPink = mascotColors[0].value
const storageKey = 'jujuba.assistant.color'

export function normalizeMascotColor(value?: string | null) {
  return value && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : originalPink
}

export function readMascotColor() {
  try { return normalizeMascotColor(localStorage.getItem(storageKey)) }
  catch { return originalPink }
}

export function saveMascotColor(value: string) {
  try { localStorage.setItem(storageKey, normalizeMascotColor(value)) }
  catch { /* A escolha continua ativa nesta sessão. */ }
}

// Map the sprite's shadows, midtones and specular highlights separately.
export function tintRamps(color: string) {
  const channels = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16) / 255)
  const charcoal = Math.max(0, 1 - Math.max(...channels) / .32)
  return channels.map((middle) => [
    0, .028, .055 + middle * .12, .06 + middle * .55 + charcoal * .045,
    Math.max(.108, middle * .95 + charcoal * .18, .06 + middle * .55),
    middle + (1 - middle) * .34, 1,
  ].join(' '))
}
