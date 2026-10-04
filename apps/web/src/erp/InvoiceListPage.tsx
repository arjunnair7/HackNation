import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { ErpInvoiceSummary } from '@apprentice/shared'
import { StatusChip, VendorBadge } from './components.tsx'
import { erpApi } from './erpApi.ts'
import { QUEUE_LABEL, SANDBOX_TODAY, STATUS_VIEWS, formatDate, formatEur, parseQueue } from './format.ts'

const dueSoon = (iso: string) => {
  const days = (Date.parse(iso) - Date.parse(SANDBOX_TODAY)) / 86_400_000
  return days >= 0 && days <= 14
}

/** A queue (/erp?queue=…) or a status view across both queues (/erp?status=…). */
export function InvoiceListPage() {
  const [params] = useSearchParams()
  const statusView = STATUS_VIEWS.find((v) => v.status === params.get('status'))
  const queue = parseQueue(params.get('queue'))
  const navigate = useNavigate()
  const [rows, setRows] = useState<ErpInvoiceSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setRows(null)
    setError(null)
    const load = statusView ? erpApi.listInvoices().then((all) => all.filter((r) => r.status === statusView.status)) : erpApi.listInvoices(queue)
    load.then(
      (list) => !cancelled && setRows(list),
      (err: Error) => !cancelled && setError(err.message),
    )
    return () => {
      cancelled = true
    }
  }, [queue, statusView])

  const open = rows?.filter((r) => r.status === 'open') ?? []
  const title = statusView ? statusView.label : QUEUE_LABEL[queue]

  return (
    <div className="erp-page">
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p className="muted">
            {statusView ? 'All queues' : 'Supplier invoices'} · December 2026{rows && ` · ${rows.length} invoices`}
          </p>
        </div>
      </div>

      {!statusView && rows && (
        <div className="kpis">
          <div className="kpi">
            <span>Open invoices</span>
            <strong>{open.length}</strong>
          </div>
          <div className="kpi">
            <span>Amount open</span>
            <strong>{formatEur(open.reduce((sum, r) => sum + r.amount, 0))}</strong>
          </div>
          <div className="kpi">
            <span>Due within 14 days</span>
            <strong>{open.filter((r) => dueSoon(r.dueDate)).length}</strong>
          </div>
        </div>
      )}

      {error && (
        <div className="banner banner-error" role="alert">
          Could not load invoices: {error}
        </div>
      )}
      {!rows && !error && <p className="muted">Loading…</p>}

      {rows && (
        <div className="card table-card">
          {rows.length === 0 ? (
            <p className="muted empty">No invoices here.</p>
          ) : (
            <table className="table queue-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Supplier</th>
                  <th>Description</th>
                  <th className="num">Amount</th>
                  <th className="nowrap">Cost center</th>
                  <th className="nowrap">Due date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => navigate(`/erp/invoices/${r.id}`)}>
                    <td className="strong nowrap">
                      <Link to={`/erp/invoices/${r.id}`} onClick={(e) => e.stopPropagation()}>
                        {r.id}
                      </Link>
                    </td>
                    <td>
                      {r.supplier.name}
                      {!r.supplier.known && <VendorBadge />}
                    </td>
                    <td className="muted-cell">{r.description}</td>
                    <td className="num strong">{formatEur(r.amount)}</td>
                    <td>
                      <span className="code">{r.costCenter}</span>
                    </td>
                    <td className="nowrap">{formatDate(r.dueDate)}</td>
                    <td>
                      <StatusChip status={r.status} routeTo={r.routeTo} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
