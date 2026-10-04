import type { ReactNode } from 'react'
import type { InvoiceStatus, RouteTarget } from '@apprentice/shared'
import { statusLabel } from './format.ts'

export function StatusChip({ status, routeTo }: { status: InvoiceStatus; routeTo?: RouteTarget }) {
  return (
    <span className={`chip chip-${status}`}>
      <span className="chip-dot" aria-hidden="true" />
      {statusLabel(status, routeTo)}
    </span>
  )
}

/** Deliberately subtle (BUILD_PLAN §5): easy to overlook. */
export function VendorBadge() {
  return <span className="badge-muted">Not in vendor master</span>
}

/** Label next to its value, inside a <dl className="fields">. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

const PATHS = {
  inbox: 'M3 13h4l2 3h6l2-3h4M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  pause: 'M9 5v14M15 5v14',
  route: 'M5 19V9a4 4 0 0 1 4-4h8m0 0-3-3m3 3-3 3',
  reset: 'M4 4v6h6M20 20v-6h-6M5.5 15a7 7 0 0 0 12.5 2.5M18.5 9A7 7 0 0 0 6 6.5',
  calendar: 'M4 7h16M8 3v4M16 3v4M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
} as const

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
