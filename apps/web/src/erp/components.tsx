import type { ReactNode } from 'react'
import type { InvoiceStatus, RouteTarget } from '@apprentice/shared'
import { statusLabel } from './format.ts'

export function StatusChip({ status, routeTo }: { status: InvoiceStatus; routeTo?: RouteTarget }) {
  return <span className={`chip chip-${status}`}>{statusLabel(status, routeTo)}</span>
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
