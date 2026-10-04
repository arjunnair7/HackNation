import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type {
  DraftPatch,
  ErpActionRequest,
  ErpGuardrailBlock,
  ErpInvoiceDetail,
  InvoiceDraft,
} from '@apprentice/shared'
import { Field, StatusChip, VendorBadge } from './components.tsx'
import { announceErpChange, erpApi } from './erpApi.ts'
import {
  CATEGORY_LABEL,
  HISTORY_STATUS_LABEL,
  ROUTE_LABEL,
  countryLabel,
  formatDate,
  formatEur,
} from './format.ts'
import { useDraftAutosave } from './useDraftAutosave.ts'

type Tab = 'invoice' | 'history'

export function InvoiceDetailPage({ invoiceId }: { invoiceId: string }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'history' ? 'history' : 'invoice'

  const [detail, setDetail] = useState<ErpInvoiceDetail | null>(null)
  const [draft, setDraft] = useState<InvoiceDraft | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const autosave = useDraftAutosave(invoiceId)

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<ErpGuardrailBlock['guardrail'] | null>(null)
  const [routeOpen, setRouteOpen] = useState(false)
  const routeRef = useRef<HTMLDivElement>(null)
  const commentRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let cancelled = false
    erpApi.getInvoice(invoiceId).then(
      (d) => {
        if (cancelled) return
        setDetail(d)
        setDraft(d.draft)
      },
      (err: Error) => !cancelled && setLoadError(err.message),
    )
    return () => {
      cancelled = true
    }
  }, [invoiceId])

  // Close the route menu on outside click or Escape.
  useEffect(() => {
    if (!routeOpen) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      const outside = e instanceof KeyboardEvent ? e.key === 'Escape' : !routeRef.current?.contains(e.target as Node)
      if (outside) setRouteOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [routeOpen])

  if (loadError) {
    return (
      <div className="erp-page">
        <nav className="crumbs">
          <Link to="/erp">← Back to queue</Link>
        </nav>
        <div className="banner banner-error" role="alert">
          Could not load {invoiceId}: {loadError}
        </div>
      </div>
    )
  }
  if (!detail || !draft) return <p className="muted">Loading…</p>

  const { invoice, supplier, costCenters } = detail
  const editable = detail.status === 'open'
  const proposal = costCenters.find((c) => c.code === invoice.defaultCostCenter)

  const setTab = (next: Tab) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === 'history') p.set('tab', 'history')
        else p.delete('tab')
        return p
      },
      { replace: true },
    )

  const edit = (patch: DraftPatch) => {
    setDraft((d) => (d ? { ...d, ...patch } : d))
    autosave.queue(patch)
  }

  const runAction = async (req: ErpActionRequest) => {
    setRouteOpen(false)
    setActionError(null)
    if (req.action === 'hold' && !draft.comment?.trim()) {
      setActionError('Add a comment before putting the invoice on hold.')
      commentRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      if (!(await autosave.flush())) {
        setActionError('The draft could not be saved, so nothing was posted. Fix the coding and try again.')
        return
      }
      const result = await erpApi.postAction(invoice.id, req)
      if (result.ok) {
        setDetail(result.detail)
        setDraft(result.detail.draft)
        setBlocked(null)
        announceErpChange()
      } else {
        setBlocked(result.blocked.guardrail)
      }
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const goToNextInvoice = async () => {
    const queuePath = `/erp?queue=${invoice.queue}`
    try {
      const list = await erpApi.listInvoices(invoice.queue)
      const i = list.findIndex((r) => r.id === invoice.id)
      const next = [...list.slice(i + 1), ...list.slice(0, Math.max(i, 0))].find((r) => r.status === 'open')
      navigate(next ? `/erp/invoices/${next.id}` : queuePath)
    } catch {
      navigate(queuePath)
    }
  }

  const saveLabel = {
    idle: '',
    saving: 'Saving draft…',
    saved: 'Draft saved',
    error: `Draft not saved: ${autosave.error ?? 'unknown error'}`,
  }[autosave.saveState]

  return (
    <div className="erp-page">
      {/* The document itself: who, how much, what for. Stays in view on both tabs. */}
      <header className="card inv-head">
        <div className="inv-head-top">
          <div>
            <div className="inv-title">
              <h1 className="inv-id">{invoice.id}</h1>
              <StatusChip status={detail.status} routeTo={detail.draft.routeTo} />
            </div>
            <div className="inv-supplier">
              {supplier.name}
              {!supplier.known && <VendorBadge />}
            </div>
          </div>
          <div className="inv-amount">
            <span className="label-sm">Amount</span>
            <span className="amount">{formatEur(invoice.amount)}</span>
          </div>
        </div>
        <table className="table lines-table">
          <thead>
            <tr>
              <th>Line item</th>
              <th>PO</th>
              <th>Asset no.</th>
              <th className="num">Qty</th>
              <th className="num">Unit price</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, i) => (
              <tr key={i}>
                <td>{line.description}</td>
                <td>{line.poNumber ?? '—'}</td>
                <td>{line.assetNumber ?? '—'}</td>
                <td className="num">
                  {line.quantity} {line.unit}
                </td>
                <td className="num">{formatEur(line.unitPrice)}</td>
                <td className="num strong">{formatEur(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </header>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" className="tab" aria-selected={tab === 'invoice'} onClick={() => setTab('invoice')}>
          Invoice
        </button>
        <button type="button" role="tab" className="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
          Supplier history
        </button>
      </div>

      {tab === 'history' ? (
        <SupplierHistory detail={detail} />
      ) : (
        <>
          <div className="inv-grid">
            <section className="card">
              <h2>Invoice details</h2>
              <dl className="fields">
                <Field label="Supplier">
                  {supplier.name}
                  {!supplier.known && <VendorBadge />}
                </Field>
                <Field label="Vendor no.">{supplier.known ? supplier.id : '—'}</Field>
                <Field label="Country">{countryLabel(supplier.country)}</Field>
                <Field label="Group company">{supplier.isSubsidiary ? 'Yes' : 'No'}</Field>
                <Field label="Invoice date">{formatDate(invoice.invoiceDate)}</Field>
                <Field label="Due date">{formatDate(invoice.dueDate)}</Field>
                <Field label="PO number">{invoice.poNumber ?? '—'}</Field>
                <Field label="Category">{CATEGORY_LABEL[invoice.category]}</Field>
              </dl>
            </section>

            <section className="card card-coding">
              <h2>Coding</h2>
              <div className="form-row">
                <label htmlFor="cost-center">Cost center</label>
                <div>
                  <select
                    id="cost-center"
                    value={draft.costCenter}
                    disabled={!editable}
                    onChange={(e) => edit({ costCenter: e.target.value })}
                  >
                    {costCenters.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                  {proposal && <div className="hint">ERP proposal: {proposal.code}</div>}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="asset-number">Asset number</label>
                <input
                  id="asset-number"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft.assetNumber ?? ''}
                  disabled={!editable}
                  onChange={(e) => edit({ assetNumber: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label htmlFor="comment">Comment</label>
                <textarea
                  id="comment"
                  ref={commentRef}
                  rows={2}
                  value={draft.comment ?? ''}
                  disabled={!editable}
                  onChange={(e) => edit({ comment: e.target.value })}
                />
              </div>
            </section>
          </div>

          {/* Sticky at the bottom of the window so the decision is always in reach. */}
          <section className="action-bar" aria-label="Actions">
            {blocked && (
              <div className="banner banner-block" role="alert">
                <strong>Held by Apprentice:</strong> {blocked.text}
              </div>
            )}
            {actionError && (
              <div className="banner banner-error" role="alert">
                {actionError}
              </div>
            )}
            <div className="action-row">
              {editable ? (
                <>
                  <div className="action-info">
                    <span className={`save-state${autosave.saveState === 'error' ? ' save-error' : ''}`}>{saveLabel}</span>
                    <span className="hint">Hold needs a comment.</span>
                  </div>
                  <div className="action-buttons">
                    <div className="route" ref={routeRef}>
                      <button
                        type="button"
                        className="btn"
                        aria-haspopup="menu"
                        aria-expanded={routeOpen}
                        disabled={busy}
                        onClick={() => setRouteOpen((open) => !open)}
                      >
                        Route for approval ▾
                      </button>
                      {routeOpen && (
                        <div className="menu" role="menu">
                          <button type="button" role="menuitem" onClick={() => void runAction({ action: 'route', routeTo: 'controller' })}>
                            Controller
                          </button>
                          <button type="button" role="menuitem" onClick={() => void runAction({ action: 'route', routeTo: 'intercompany' })}>
                            Intercompany
                          </button>
                        </div>
                      )}
                    </div>
                    <button type="button" className="btn" disabled={busy} onClick={() => void runAction({ action: 'hold' })}>
                      Hold
                    </button>
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void runAction({ action: 'approve' })}>
                      Approve &amp; post
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <Outcome detail={detail} />
                  <div className="action-buttons">
                    <Link className="btn" to={`/erp?queue=${invoice.queue}`}>
                      Back to queue
                    </Link>
                    <button type="button" className="btn btn-primary" onClick={() => void goToNextInvoice()}>
                      Next invoice →
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Outcome({ detail }: { detail: ErpInvoiceDetail }) {
  const { status, draft, costCenters } = detail
  const cc = costCenters.find((c) => c.code === draft.costCenter)
  const ccText = cc ? `${cc.code} · ${cc.name}` : draft.costCenter

  if (status === 'posted') {
    return (
      <div className="outcome outcome-posted">
        <strong>Posted to ledger</strong>
        <div>
          Cost center {ccText}
          {draft.assetNumber && (
            <>
              {' · '}
              <span className="nowrap">Asset {draft.assetNumber}</span>
            </>
          )}
        </div>
      </div>
    )
  }
  if (status === 'on_hold') {
    return (
      <div className="outcome outcome-on_hold">
        <strong>On hold</strong>
        <div>Comment: {draft.comment}</div>
      </div>
    )
  }
  return (
    <div className="outcome outcome-routed">
      <strong>Routed to {draft.routeTo ? ROUTE_LABEL[draft.routeTo] : '—'} for approval</strong>
      <div>Cost center {ccText}</div>
    </div>
  )
}

function SupplierHistory({ detail }: { detail: ErpInvoiceDetail }) {
  const { supplier, history } = detail
  // Document history first: it's what this tab is opened for, so it should be above the fold.
  return (
    <>
      <section className="card">
        <h2>Document history</h2>
        {history.length === 0 ? (
          <p className="muted">No previous documents for this supplier.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Document</th>
                <th>Description</th>
                <th>Cost center</th>
                <th className="num">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.documentId}>
                  <td>{formatDate(h.date)}</td>
                  <td className="strong">{h.documentId}</td>
                  <td>{h.description}</td>
                  <td>{h.costCenter ?? '—'}</td>
                  <td className="num">{formatEur(h.amount)}</td>
                  <td>{HISTORY_STATUS_LABEL[h.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Supplier</h2>
        <dl className="fields fields-2col">
          <Field label="Name">{supplier.name}</Field>
          <Field label="Vendor no.">{supplier.known ? supplier.id : '—'}</Field>
          <Field label="Location">
            {supplier.city}, {countryLabel(supplier.country)}
          </Field>
          <Field label="Vendor master">
            {supplier.known && supplier.vendorSince
              ? `Registered since ${formatDate(supplier.vendorSince)}`
              : 'Not in vendor master'}
          </Field>
          <Field label="Group company">{supplier.isSubsidiary ? 'Yes (subsidiary)' : 'No'}</Field>
        </dl>
      </section>
    </>
  )
}
