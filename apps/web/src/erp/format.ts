import type { ErpQueue, InvoiceCategory, InvoiceStatus, RouteTarget, SupplierHistoryEntry } from '@apprentice/shared'

// Fixed sandbox setting (BUILD_PLAN §5). Static on purpose: no ticking clock on the shared screen.
export const SANDBOX_PERIOD = 'Period: December 2026 · Close in 2 days'
export const SANDBOX_CLOCK = 'Thu 10 Dec 2026 · 16:10'

export const QUEUE_LABEL: Record<ErpQueue, string> = {
  expert: "Sabine's queue",
  trainee: "Lena's queue",
}

export function parseQueue(value: string | null): ErpQueue {
  return value === 'trainee' ? 'trainee' : 'expert'
}

const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })
export const formatEur = (amount: number) => eur.format(amount)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-12-03" → "03 Dec 2026" */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`
}

export const ROUTE_LABEL: Record<RouteTarget, string> = { controller: 'Controller', intercompany: 'Intercompany' }

export function statusLabel(status: InvoiceStatus, routeTo?: RouteTarget): string {
  switch (status) {
    case 'open':
      return 'Open'
    case 'posted':
      return 'Posted'
    case 'on_hold':
      return 'On hold'
    case 'routed':
      return routeTo ? `Routed → ${ROUTE_LABEL[routeTo]}` : 'Routed'
  }
}

export const CATEGORY_LABEL: Record<InvoiceCategory, string> = {
  equipment: 'Equipment',
  consumables: 'Consumables',
  services: 'Services',
}

const COUNTRY: Record<string, string> = { DE: 'Germany', CZ: 'Czech Republic' }
export const countryLabel = (code: string) => (COUNTRY[code] ? `${COUNTRY[code]} (${code})` : code)

export const HISTORY_STATUS_LABEL: Record<SupplierHistoryEntry['status'], string> = {
  paid: 'Paid',
  credited: 'Credited',
  applied: 'Applied',
}
