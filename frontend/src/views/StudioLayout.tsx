import { useState, type CSSProperties, type ReactNode } from 'react'
import { Explorer } from './Explorer'
import { SidebarDivider } from './SidebarDivider'
import type { TreeItem } from '../controllers/useExplorer'

const minimum = 160
const maximum = 640
const defaultWidth = 274
const preference = 'nexo.explorer.width'

function clamp(width: number) {
  return Math.max(minimum, Math.min(maximum, width))
}

function readWidth() {
  try {
    const saved = Number(localStorage.getItem(preference))
    return saved > 0 && Number.isFinite(saved) ? clamp(saved) : defaultWidth
  } catch {
    return defaultWidth
  }
}

function saveWidth(width: number) {
  try { localStorage.setItem(preference, String(width)) } catch { /* preference is optional */ }
}

export function StudioLayout({ items, connected, children }: {
  items: TreeItem[]
  connected: boolean
  children: ReactNode
}) {
  const [width, setWidth] = useState(readWidth)
  const [dragging, setDragging] = useState(false)

  return <div className={dragging ? 'studio resizing' : 'studio'} style={{ '--explorer-width': width + 'px' } as CSSProperties}>
    <Explorer items={items} connected={connected} />
    <SidebarDivider side="left" width={width} minimum={minimum} maximum={maximum}
      defaultWidth={defaultWidth} label="Largura do Explorador de objetos" controls="object-explorer"
      onDrag={setDragging} onWidth={(next, settled) => {
        setWidth(next)
        if (settled) saveWidth(next)
      }} />
    {children}
  </div>
}