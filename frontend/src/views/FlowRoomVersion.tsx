import { useEffect } from 'react'
import { Download } from 'lucide-react'
import { version as buildVersion } from '../../package.json'
import { compareVersions } from '../controllers/flowUpgrade'
import { useDesktopUpdates, type PrepareUpdate } from './DesktopUpdates'

export function FlowRoomVersion({ peerVersion, prepare, disabled }: {
  peerVersion?: string | null
  prepare: PrepareUpdate
  disabled: boolean
}) {
  const updates = useDesktopUpdates()
  const difference = peerVersion ? compareVersions(peerVersion, buildVersion) : 0
  const refresh = updates?.refresh
  useEffect(() => {
    if (difference > 0) void refresh?.(false)
  }, [difference, refresh])

  if (!peerVersion) return <small>O outro aplicativo ainda não informa a versão.</small>
  const ready = updates?.version && compareVersions(updates.version, peerVersion) >= 0
  return <span className="flow-room-version">
    <span>Outra pessoa <strong>v{peerVersion}</strong>{difference !== 0 && <> · Você <strong>v{buildVersion}</strong></>}</span>
    {difference < 0 && <small>A outra pessoa pode atualizar pelo rodapé.</small>}
    {difference > 0 && updates && <>
      {ready && updates.status !== 'checking' ?
        <button type="button" className="button design-accent" disabled={disabled || updates.busy}
          onClick={() => void updates.install(prepare)}><Download size={15} />Atualizar agora</button> :
        <button type="button" className="button" disabled={disabled || updates.status === 'checking'}
          onClick={() => void updates.refresh(true)}>
          {updates.status === 'checking' ? 'Verificando atualização…' : 'Verificar atualização'}
        </button>}
    </>}
  </span>
}
