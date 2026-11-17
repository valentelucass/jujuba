import { useId } from 'react'

export const hats = {
  none: 'Sem chapéu',
  pirate: 'Pirata',
  redCap: 'Quepe vermelho',
  cowboy: 'Cowboy',
  wizard: 'Bruxo',
  crown: 'Coroa',
  beanie: 'Gorro',
  topHat: 'Cartola',
  chef: 'Chef',
  cat: 'Gatinho',
  astronaut: 'Astronauta',
  viking: 'Viking',
  party: 'Festa',
  straw: 'Palha',
  beret: 'Boina',
  detective: 'Detetive',
  leather: 'Chapéu de couro',
  brazil: 'Brasil',
} as const

export type Hat = keyof typeof hats
type Style = Exclude<Hat, 'none'>

const storageKey = 'jujuba.assistant.hat'

export function readHat(): Hat {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved === 'gonzaga') return 'leather'
    if (saved && Object.hasOwn(hats, saved)) return saved as Hat
  } catch { /* Customization is optional when storage is unavailable. */ }
  return 'none'
}

export function saveHat(hat: Hat) {
  try { localStorage.setItem(storageKey, hat) } catch { /* The selection stays active for this session. */ }
}

const palette: Record<Style, [string, string, string]> = {
  pirate: ['#533b66', '#1a112a', '#140d22'],
  redCap: ['#f34a3f', '#ac142c', '#511426'],
  cowboy: ['#f3bd73', '#af602f', '#61371f'],
  wizard: ['#a573ec', '#592a96', '#32175c'],
  crown: ['#ffec92', '#e69c22', '#8b4e1b'],
  beanie: ['#82dfbc', '#238b75', '#13473d'],
  topHat: ['#5d5278', '#271b35', '#140d23'],
  chef: ['#fff7ee', '#ddd0ec', '#65546b'],
  cat: ['#ffdab2', '#d68484', '#744758'],
  astronaut: ['#8ae2f2', '#526bb4', '#27365d'],
  viking: ['#e3e3ec', '#7e89a9', '#444c6e'],
  party: ['#ff91bf', '#da3e93', '#6f286a'],
  straw: ['#ffe490', '#ce9247', '#81512e'],
  beret: ['#f788ae', '#9f346c', '#562042'],
  detective: ['#c4bd96', '#817549', '#4d4532'],
  leather: ['#c98953', '#88482a', '#4a271c'],
  brazil: ['#58c868', '#156948', '#124832'],
}

export function MascotHat({ hat, miniature = false }: { hat: Hat; miniature?: boolean }) {
  const id = useId()
  if (hat === 'none') return null
  const [light, shade, stroke] = palette[hat]
  return <svg className={miniature ? 'hat-miniature' : 'jujuba-hat'} data-hat={hat} viewBox="0 0 120 76" aria-hidden="true">
    <defs>
      <linearGradient id={id} x1="0" x2=".6" y2="1" y1="0" gradientUnits="objectBoundingBox">
        <stop stopColor={light} /><stop offset="1" stopColor={shade} />
      </linearGradient>
    </defs>
    <g stroke={stroke} strokeWidth="2.7" strokeLinejoin="round" strokeLinecap="round">
      <HatArt hat={hat} fill={`url(#${id})`} />
    </g>
  </svg>
}

function HatArt({ hat, fill }: { hat: Style; fill: string }) {
  switch (hat) {
    case 'pirate':
      return <>
        <path d="M91 53q14 1 23 14l-10 1-4 7-14-17" fill="#d94265" />
        <path d="M7 47c10 3 17 1 22-6 8-12 12-24 28-26 16-2 22 10 31 19 6 7 15 9 25 2l-4 15c-5 15-25 18-51 18C32 69 13 62 7 47Z" fill={fill} />
        <path d="M13 48c12 4 22-1 28-10 7-10 11-15 20-14 9 0 15 12 23 17 7 6 15 6 24 1" fill="none" stroke="#f3be6c" strokeWidth="2.8" />
        <path d="M18 55c17 13 67 15 87 0" fill="none" stroke="#956051" strokeWidth="1.5" />
        <g stroke="#ffe6ba" strokeWidth="3"><path d="m48 59 23-13m-21-1 21 14" /><path d="m48 58-2 2m3-1-1 2m23-16 2-1m-2 14 2 2m-24-15-2-2" /></g>
        <path d="M51 42a9 8 0 1 1 18 0q0 6-5 8v5h-8v-5q-5-2-5-8Z" fill="#fff3d2" stroke="none" />
        <path d="M56 43h.2m7.6 0h.2" stroke="#261738" strokeWidth="3.6" />
      </>
    case 'redCap':
      return <>
        <path d="M12 40 21 28q14-10 39-11 25 1 39 11l9 12-11 18Q60 49 24 58Z" fill={fill} />
        <path d="M17 40q13-13 42-16 29 2 44 16" stroke="#ff9c8d" strokeWidth="2.5" fill="none" />
        <path d="M21 47q39-7 78 0l-2 13q-35 10-74 0Z" fill="#841b2d" />
        <path d="M23 57q36 8 74-1l9 7q-6 13-45 12-38 0-45-10Z" fill="#291b28" />
        <path d="M28 65q30 9 64 0" stroke="#786272" strokeWidth="2" fill="none" />
        <path d="M24 54q37 8 73-1" stroke="#f9b94f" strokeWidth="2.9" fill="none" />
        <path d="m60 29 3.7 8.1 8.8.8-6.7 5.8 2 8.6-7.8-4.4-7.8 4.4 2-8.6-6.7-5.8 8.8-.8Z" fill="#ffdc72" stroke="#842437" strokeWidth="1.4" />
      </>
    case 'cowboy':
      return <>
        <path d="M24 53 32 29q3-11 12-11l12 7 13-8q11-1 16 11l9 24" fill={fill} />
        <path d="M26 48q33 12 65-1l3 9-68 2Z" fill="#713827" /><path d="m58 54 8-1 1 7-8 1Z" fill="#ffce72" strokeWidth="1.4" />
        <path d="M5 43q12 12 23 11 33 14 65-2 14-4 21-13 1 16-15 23-24 13-59 7Q15 64 5 43Z" fill={fill} />
        <path d="M15 53q21 18 66 10" stroke="#fce2a7" strokeWidth="1.8" fill="none" />
      </>
    case 'wizard':
      return <>
        <path d="M29 55Q38 27 64 10 81-2 97 9q-21 6-19 20l17 28Z" fill={fill} />
        <path d="M26 53q27 11 61-2l7 8-65 6Z" fill="#3c1e67" />
        <path d="M9 60q35-10 58-5 27 1 44 9-18 9-56 8-32 0-46-12Z" fill={fill} />
        <path d="m60 25 2.8 6.7 7 2.4-6.5 2.7-2.7 7-2.5-7-6.6-2.5 6.2-2.7Z" fill="#ffe495" stroke="none" />
        <path d="m43 46 1.2-3 1.4 3 3 .9-3 1.6L44 52l-1-3.5-3-1.5Zm32-1q4 1 6-4-7 5-7-5-5 7 1 9Z" fill="#ffc975" stroke="none" />
      </>
    case 'crown':
      return <>
        <path d="m19 31 21 14 20-26 20 26 22-14-8 30q-34 10-69-1Z" fill={fill} />
        <path d="M25 59q34 9 70 0l-3 9q-32 7-65-1Z" fill="#f4b640" />
        <path d="M25 51q20 13 72 0" stroke="#fff0a1" fill="none" />
        <path d="m60 41 8 9-8 8-8-8Z" fill="#da4787" strokeWidth="1.6" />
        <circle cx="19" cy="30" r="4.5" fill="#ffe98a" /><circle cx="60" cy="18" r="5.5" fill="#ffa33e" /><circle cx="102" cy="30" r="4.5" fill="#ffe98a" />
      </>
    case 'beanie':
      return <>
        <path d="M21 59Q20 23 54 21q37-2 43 32L84 67Z" fill={fill} />
        <path d="M36 51q1-19 18-29m21 30q-1-18-11-26" stroke="#a3efd1" fill="none" strokeWidth="2.1" />
        <circle cx="54" cy="18" r="10" fill="#bbf0d1" strokeWidth="2" />
        <path d="M20 55q38 10 78-3l3 10q-33 12-78 4Z" fill="#459e87" />
        <path d="m33 59 2 7 8 1-2-7m9 1 1 7m10-7v7m10-8v7m8-8v6m9-8v6" stroke="#a9e9cc" strokeWidth="1.7" fill="none" />
      </>
    case 'topHat':
      return <>
        <path d="M29 56 23 16q37-13 75 0l-8 43" fill={fill} />
        <ellipse cx="60" cy="16" rx="36" ry="8" fill="#6c5a81" />
        <path d="M28 46q29 8 64 0l-2 13q-37 9-60-1Z" fill="#b8356c" />
        <path d="M10 57q10-5 22 1 33 10 60-2 12-4 19 1 0 14-50 15Q12 72 10 57Z" fill={fill} />
        <path d="m76 49 9-1-1 9-9 1Z" fill="#ffd275" strokeWidth="1.5" />
      </>
    case 'chef':
      return <>
        <path d="M27 56Q12 54 15 40q3-11 18-9 2-17 16-18 11-1 16 10 13-9 23 4 16-2 19 11 3 11-12 18l-3 12q-31 6-63 0Z" fill={fill} />
        <path d="M29 53q29 8 65 2l-2 13q-32 6-63 0Z" fill="#fff3ed" />
        <path d="M47 36q7 3 7 16m22-17q-7 5-7 18" fill="none" stroke="#a697b3" strokeWidth="2" />
      </>
    case 'cat':
      return <>
        <path d="M15 53Q13 35 17 10q3-5 26 19 17-6 34 0 23-24 26-19 4 26 1 43-5 18-44 19-39-1-45-19Z" fill={fill} />
        <path d="m23 18 13 15-13 8Zm73 0-13 15 13 8Z" fill="#ffcef0" stroke="#ad5a81" strokeWidth="1.4" />
        <path d="M27 40q14-11 33-11" fill="none" stroke="#ffe1dc" strokeWidth="2.1" />
        <path d="M40 49q5-5 10 0m20 0q5-5 10 0" fill="none" stroke="#42273c" strokeWidth="2.8" />
        <circle cx="36" cy="56" r="4.1" fill="#ff9ebb" stroke="none" /><circle cx="84" cy="56" r="4.1" fill="#ff9ebb" stroke="none" />
        <path d="M56 53q4-2 8 0l-4 4Z" fill="#7d3659" stroke="none" />
        <path d="M60 56q-2 6-8 2m8-2q2 6 8 2m-38-7 9 2m-9 6 9-1m51-7-9 2m9 6-9-1" strokeWidth="1.4" fill="none" />
      </>
    case 'astronaut':
      return <>
        <path d="M21 60v-13q0-31 38-32 37 0 40 32v13q-17 10-41 10-23 0-37-10Z" fill="#e5e5f2" />
        <path d="M20 43q41-15 80-6v17q-23 13-80 7Z" fill={fill} />
        <path d="M33 45q9-5 29-6" stroke="#c5f7fc" strokeWidth="3.5" fill="none" />
        <path d="M28 64h13m44-1h7" stroke="#ef699f" strokeWidth="3" />
        <circle cx="92" cy="47" r="3.7" fill="#b5ffdb" strokeWidth="1.4" />
      </>
    case 'viking':
      return <>
        <path d="M30 51Q9 49 7 24q15 15 27 11m55 15q22-1 24-25-12 13-25 10" fill="#ffe8c4" />
        <path d="M23 60q1-33 36-36 34-2 39 34-23 12-75 2Z" fill={fill} />
        <path d="M51 26q8 3 14-1l4 37-19 2Z" fill="#c6d1eb" />
        <path d="M21 56q37 7 78-2l-1 10q-39 13-76 2Z" fill="#626a8b" />
        <path d="M33 62h1m17 3h1m17-1h1m17-3h1" stroke="#ffd392" strokeWidth="3.2" />
      </>
    case 'party':
      return <>
        <path d="M25 61 60 14 95 61q-30 16-70 0Z" fill={fill} />
        <path d="M40 43q11 2 27-16m-37 29q26 5 48-17m-49 26q36 3 59-15" stroke="#ffd683" strokeWidth="4.2" fill="none" />
        <path d="M29 63q26 10 60-1" stroke="#fffec4" strokeWidth="2" fill="none" />
        <circle cx="60" cy="15" r="6" fill="#ffdabb" />
        <path d="m16 37 7-2m-3 14-6 1m86-12 6-3m-7 15 7 3" stroke="#f9b768" strokeWidth="3" />
      </>
    case 'straw':
      return <>
        <path d="M28 53q4-9 8-23 4-12 23-12 18-1 25 12 7 13 8 23" fill={fill} />
        <path d="M33 43q24 8 54-1l4 10q-31 13-63 1Z" fill="#c24d70" />
        <path d="M9 55q19-8 50-4 29-5 52 2-3 13-48 16-42 2-54-14Z" fill={fill} />
        <path d="M20 58q39 12 80-2m-83 3q2 4 10 6m64-1q8-1 14-7" stroke="#fff0ac" fill="none" strokeWidth="1.8" />
      </>
    case 'beret':
      return <>
        <path d="M21 59q-7-4-4-13 4-15 26-21 26-8 48 5 16 9 10 22-13 14-80 7Z" fill={fill} />
        <path d="M22 59q40 3 75-8l-3 13q-30 11-69 4Z" fill="#74294f" />
        <path d="M29 40q11-14 43-13m-15-6 5-8" stroke="#ffd0dd" strokeWidth="2.8" fill="none" />
        <path d="m86 44 3-2 2 3-3 2Z" fill="#ffcf79" strokeWidth="1.2" />
      </>
    case 'leather':
      return <>
        <path d="M13 58 9 69l6 1 4-9m87-4 6 14-6 2-6-12" fill="#643722" />
        <path d="M8 56 23 40q7-26 34-28 27-2 40 24l17 18q-9 9-30 11-27 3-51 2Q16 64 8 56Z" fill="#723d24" />
        <path d="M8 51C17 52 25 42 34 30 42 19 50 14 61 14c13 0 24 9 32 19q15 16 22 16l-5 11Q87 74 59 72 29 73 9 60Z" fill={fill} />
        <path d="M14 54c10 0 19-13 26-22 6-8 14-13 21-13 9 0 17 7 23 13q17 17 25 21" fill="none" stroke="#f4bf7e" strokeWidth="1.5" strokeDasharray="2.1 3.1" />
        <path d="M18 59q38 16 85-3" fill="none" stroke="#e7a65c" strokeWidth="2.5" />
        <g fill="#fce0ac" strokeWidth="1.1">
          <path d="m60 28 3.1 5.7 6.9-.1-3.4 5.7 3.4 5.8-6.9-.1-3.1 5.8-3.2-5.8-6.7.1 3.2-5.8-3.2-5.7 6.7.1Z" />
          <path d="m33 44 2.1 3.2 4 .1-2 3.4 2 3.5-4-.1-2.1 3.6-2-3.6-4.1.1 2-3.5-2-3.4 4 .1Zm54-1 2.1 3.2 4 .1-2 3.4 2 3.5-4-.1-2.1 3.6-2-3.6-4.1.1 2-3.5-2-3.4 4 .1Z" />
        </g>
        <path d="M46 61h.2m6 2h.2m7.5 1h.2m7.5-1h.2m6-2h.2" stroke="#ffce83" strokeWidth="3.2" />
      </>
    case 'brazil':
      return <>
        <path d="M22 49q1-9 6-24 29-13 62-3 6 8 9 24L91 57 26 59Z" fill={fill} />
        <path d="M30 28q24-10 56-4" fill="none" stroke="#b0e885" strokeWidth="2.2" />
        <path d="M22 49q43 11 77-3l14 16q-15 11-52 12-37 1-52-11Z" fill={fill} />
        <path d="M16 62q39 13 90-2" fill="none" stroke="#90dc7a" strokeWidth="1.9" />
        <path d="M34 29h51v27H34Z" fill="#188944" stroke="#126437" strokeWidth="1.1" />
        <path d="m60 30 23 12-23 13-23-13Z" fill="#ffdb43" stroke="none" />
        <circle cx="60" cy="42" r="8" fill="#294d9f" stroke="none" />
        <path d="M52.6 39.5q7-1.5 14.8 5.4" fill="none" stroke="#fff9ed" strokeWidth="2.1" />
        <path d="M57 45h.2m3 3h.2m5-1h.2m-4.5-9h.2" stroke="#fafafa" strokeWidth="1.2" />
      </>
    case 'detective':
      return <>
        <path d="M25 48q0-20 22-27l14 7 10-7q22 5 26 23l-5 13-61 1Z" fill={fill} />
        <path d="M54 29q5 7 3 20M26 44q34 12 68 0" fill="none" />
        <path d="M12 47q11-1 21 6 28 11 63-13l13 5q-1 14-35 22-40 9-62-20Z" fill={fill} />
        <path d="M32 31 44 41m-7-15 17 16m18-16 11 12m-16-7 11 12" stroke="#e0d2a5" strokeWidth="1.4" fill="none" />
      </>
  }
}
