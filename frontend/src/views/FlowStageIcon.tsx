import type { NodeKind } from '../models/systemDiagram'

export function FlowStageIcon({ kind, size = 18 }: { kind: NodeKind; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
    {kind === 'start' && <><rect x="2" y="6" width="20" height="12" rx="6" /><path d="m10 9 5 3-5 3Z" /></>}
    {kind === 'action' && <rect x="3" y="5" width="18" height="14" rx="1" />}
    {kind === 'decision' && <path d="M12 2 22 12 12 22 2 12Z" />}
    {kind === 'inputOutput' && <path d="M6 5h16l-4 14H2Z" />}
    {kind === 'document' && <path d="M3 4h18v14c-6-5-11 5-18 1Z" />}
    {kind === 'subprocess' && <><rect x="2" y="5" width="20" height="14" rx="1" /><path d="M6 5v14m12-14v14" /></>}
    {kind === 'connector' && <circle cx="12" cy="12" r="6" />}
    {kind === 'end' && <><rect x="2" y="6" width="20" height="12" rx="6" /><rect x="10" y="10" width="4" height="4" /></>}
  </svg>
}
