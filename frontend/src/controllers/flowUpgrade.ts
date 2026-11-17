import { version as buildVersion } from '../../package.json'

const preference = 'jujuba.flow.resume-after-update'
const lifetime = 20 * 60_000

export type FlowUpgrade = { kind: 'join'; code: string; name: string } |
  { kind: 'host'; project: string; resumeInvite: boolean }

export function compareVersions(a: string, b: string) {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] || 0) - (right[index] || 0)
    if (difference) return difference
  }
  return 0
}

export function rememberFlowUpgrade(upgrade: FlowUpgrade) {
  try {
    localStorage.setItem(preference, JSON.stringify({ upgrade, from: buildVersion, expiry: Date.now() + lifetime }))
  } catch { /* Pode pedir para entrar outra vez pelo convite. */ }
}

export function readFlowUpgrade(): FlowUpgrade | null {
  try {
    const saved = JSON.parse(localStorage.getItem(preference) ?? 'null')
    if (!saved || typeof saved.expiry !== 'number' || saved.expiry <= Date.now() ||
      typeof saved.from !== 'string' || compareVersions(buildVersion, saved.from) <= 0) return null
    if (saved.upgrade?.kind === 'join' && typeof saved.upgrade.code === 'string' && typeof saved.upgrade.name === 'string') {
      return saved.upgrade
    }
    if (saved.upgrade?.kind === 'host' && typeof saved.upgrade.project === 'string' && typeof saved.upgrade.resumeInvite === 'boolean') {
      return saved.upgrade
    }
  } catch { /* A inicialização padrão continua disponível. */ }
  return null
}

export function clearFlowUpgrade() {
  try { localStorage.removeItem(preference) } catch { /* A preferência local é opcional. */ }
}
