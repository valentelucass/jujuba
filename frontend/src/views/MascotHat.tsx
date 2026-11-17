export const hats = {
  none: 'Sem chapéu',
  pirate: 'Pirata',
  redCap: 'Quepe vermelho',
  cowboy: 'Cowboy',
  wizard: 'Bruxo',
  crown: 'Coroa',
  beanie: 'Gorro',
} as const

export type Hat = keyof typeof hats

const storageKey = 'jujuba.assistant.hat'

export function readHat(): Hat {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved && Object.hasOwn(hats, saved)) return saved as Hat
  } catch { /* Customization is optional when storage is unavailable. */ }
  return 'none'
}

export function saveHat(hat: Hat) {
  try { localStorage.setItem(storageKey, hat) } catch { /* The selection stays active for this session. */ }
}

export function MascotHat({ hat, miniature = false }: { hat: Hat; miniature?: boolean }) {
  if (hat === 'none') return null
  return <svg className={miniature ? 'hat-miniature' : 'jujuba-hat'}
    viewBox={miniature ? '185 -20 880 385' : '0 0 1254 1254'} aria-hidden="true">
    {hat === 'pirate' && <>
      <path d="M207 173Q319 232 405 136Q515-10 625 93Q735-10 845 136Q931 232 1043 173Q1040 327 625 338Q210 327 207 173Z"
        fill="#29201f" stroke="#efb45d" strokeWidth="21" />
      <path d="M510 273Q575 246 625 270Q676 246 741 273" fill="none" stroke="#f8e7bd" strokeWidth="18" strokeLinecap="round" />
      <path d="M566 208a61 55 0 1 1 122 0q0 33-27 44v24h-69v-24q-26-12-26-44Z" fill="#fff2d2" />
      <path d="M604 211h1m44 0h1" stroke="#29201f" strokeWidth="26" strokeLinecap="round" />
    </>}
    {hat === 'redCap' && <>
      <path d="M280 213Q290 91 613 71Q937 96 974 212L910 296H313Z" fill="#c43841" stroke="#6d1d31" strokeWidth="18" />
      <path d="M319 259Q601 209 929 260L979 299Q701 367 324 305Z" fill="#781c31" stroke="#471223" strokeWidth="14" />
      <path d="m623 113 17 32 36 6-26 26 6 36-33-17-33 17 6-36-26-26 36-6Z" fill="#ffcf69" />
    </>}
    {hat === 'cowboy' && <>
      <path d="M350 242 395 81Q519 30 625 131Q737 31 859 81L905 242Z" fill="#ba713f" stroke="#623824" strokeWidth="18" />
      <path d="M371 218Q625 271 886 218L914 258H338Z" fill="#683b28" />
      <path d="M205 211Q349 232 371 254Q619 306 881 254Q953 222 1047 209Q1015 349 630 342Q241 346 205 211Z"
        fill="#d89252" stroke="#6a3d27" strokeWidth="18" />
    </>}
    {hat === 'wizard' && <>
      <path d="M377 264Q453 137 598 55Q711-10 817 28Q733 83 757 152L878 274Z" fill="#7753ae" stroke="#40266c" strokeWidth="19" />
      <path d="M387 229Q610 284 824 229L883 281H366Z" fill="#3c235f" />
      <path d="M220 289Q610 220 1020 290Q925 363 620 352Q316 356 220 289Z" fill="#8761c5" stroke="#40266c" strokeWidth="18" />
      <path d="m633 134 13 32 35 12-35 13-13 32-13-32-35-13 35-12Z" fill="#ffd56d" />
    </>}
    {hat === 'crown' && <>
      <path d="m313 132 158 77L623 66l151 143 159-77-74 178Q624 365 389 310Z" fill="#ffca52" stroke="#a36226" strokeWidth="18" />
      <path d="M381 286Q625 327 868 286" fill="none" stroke="#fff0a2" strokeWidth="20" />
      <path d="m623 175 52 42-52 44-52-44Z" fill="#d54b81" />
      <circle r="23" cx="317" cy="128" fill="#fff0a2" /><circle r="23" cx="927" cy="128" fill="#fff0a2" />
    </>}
    {hat === 'beanie' && <>
      <path d="M350 264Q341 68 615 65Q894 66 899 264Z" fill="#5da583" stroke="#2e6959" strokeWidth="17" />
      <path d="M343 230Q611 270 905 224L923 298Q615 351 324 299Z" fill="#377e6b" stroke="#2e6959" strokeWidth="17" />
      <path d="M450 217Q446 128 565 77m184 144Q775 135 665 80" fill="none" stroke="#8ac3a8" strokeWidth="18" />
      <circle r="44" cx="614" cy="49" fill="#8ac3a8" stroke="#2e6959" strokeWidth="13" />
    </>}
  </svg>
}
