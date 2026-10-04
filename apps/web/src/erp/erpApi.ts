import type {
  DraftPatch,
  ErpActionRequest,
  ErpGuardrailBlock,
  ErpInvoiceDetail,
  ErpInvoiceSummary,
  ErpQueue,
  InvoiceDraft,
} from '@apprentice/shared'

export class ErpApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(messageOf(body) ?? `Request failed (${status})`)
    this.status = status
    this.body = body
  }
}

function messageOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('message' in body)) return undefined
  const { message } = body as { message: unknown }
  if (Array.isArray(message)) return message.join('; ')
  return typeof message === 'string' ? message : undefined
}

function isGuardrailBlock(body: unknown): body is ErpGuardrailBlock {
  return typeof body === 'object' && body !== null && (body as { error?: unknown }).error === 'guardrail_blocked'
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/erp${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) throw new ErpApiError(res.status, body)
  return body as T
}

export type ActionResult = { ok: true; detail: ErpInvoiceDetail } | { ok: false; blocked: ErpGuardrailBlock }

const invoicePath = (id: string) => `/invoices/${encodeURIComponent(id)}`

export const erpApi = {
  listInvoices: (queue?: ErpQueue) => request<ErpInvoiceSummary[]>(queue ? `/invoices?queue=${queue}` : '/invoices'),

  getInvoice: (id: string) => request<ErpInvoiceDetail>(invoicePath(id)),

  patchDraft: (id: string, patch: DraftPatch) =>
    request<InvoiceDraft>(`${invoicePath(id)}/draft`, { method: 'PATCH', body: JSON.stringify(patch) }),

  /** A 409 from the save gate comes back as { ok: false, blocked } instead of throwing. */
  async postAction(id: string, req: ErpActionRequest): Promise<ActionResult> {
    try {
      const detail = await request<ErpInvoiceDetail>(`${invoicePath(id)}/action`, {
        method: 'POST',
        body: JSON.stringify(req),
      })
      return { ok: true, detail }
    } catch (err) {
      if (err instanceof ErpApiError && err.status === 409 && isGuardrailBlock(err.body)) {
        return { ok: false, blocked: err.body }
      }
      throw err
    }
  },

  reset: () => request<{ ok: true }>('/reset', { method: 'POST' }),
}

/** Tells the layout (sidebar counts) that invoices changed. */
export function announceErpChange() {
  window.dispatchEvent(new Event('erp:changed'))
}
