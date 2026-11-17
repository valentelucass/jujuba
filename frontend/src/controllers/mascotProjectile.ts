import type { FlightBounds, Point } from './mascotMotion'

export type MascotTarget = 'own' | 'peer' | 'clone'
export type ShotTarget = { target: MascotTarget; point: Point }
export type ShotContact = { distance: number; normal: Point; target?: MascotTarget }

const hitRadius = 24

export function unitVector(x: number, y: number, fallback: Point = { x: -1, y: 0 }): Point {
  const length = Math.hypot(x, y)
  return length > .001 ? { x: x / length, y: y / length } : fallback
}

export function reflect(direction: Point, normal: Point): Point {
  const approach = direction.x * normal.x + direction.y * normal.y
  return { x: direction.x - 2 * approach * normal.x, y: direction.y - 2 * approach * normal.y }
}

export function traceProjectile(origin: Point, direction: Point, distance: number, area: FlightBounds,
  targets: ShotTarget[], touched: ReadonlySet<MascotTarget>): ShotContact | null {
  const dx = direction.x
  const dy = direction.y
  const horizontal = dx > 0 ? (area.right - origin.x) / dx : dx < 0 ? (area.left - origin.x) / dx : Infinity
  const vertical = dy > 0 ? (area.bottom - origin.y) / dy : dy < 0 ? (area.top - origin.y) / dy : Infinity
  const edge = Math.max(0, Math.min(horizontal, vertical))
  let contact: ShotContact | null = edge <= distance ? {
    distance: edge, normal: { x: horizontal <= vertical ? -Math.sign(dx) : 0, y: vertical <= horizontal ? -Math.sign(dy) : 0 },
  } : null
  if (horizontal === vertical && contact) contact.normal = unitVector(contact.normal.x, contact.normal.y)
  for (const { target, point } of targets) {
    if (touched.has(target)) continue
    const x = point.x - origin.x
    const y = point.y - origin.y
    const toward = x * dx + y * dy
    if (toward <= 0) continue
    const sideways = Math.abs(x * dy - y * dx)
    if (sideways > hitRadius) continue
    const entry = Math.max(0, toward - Math.sqrt(hitRadius ** 2 - sideways ** 2))
    if (entry > (contact?.distance ?? distance)) continue
    contact = { distance: entry, target, normal: unitVector(dx * entry - x, dy * entry - y, { x: -dx, y: -dy }) }
  }
  return contact
}
