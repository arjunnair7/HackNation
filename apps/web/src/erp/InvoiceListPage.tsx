import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { ErpInvoiceSummary } from '@apprentice/shared'
import { StatusChip, VendorBadge } from './components.tsx'
import { erpApi } from './erpApi.ts'
import { QUEUE_LABEL, formatDate, formatEur, parseQueue } from './format.ts'

export function InvoiceListPage() {
  const [params] = useSearchParams()
  const queue = parseQueue(params.get('queue'))
  const navigate = useNavigate()
  const [rows, setRows] = useState<ErpInvoiceSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setRows(null)
    setError(null)
    erpApi.listInvoices(queue).then(
      (list) => !cancelled && setRows(list),
      (err: Error) => !cancelled && setError(err.message),
    )
    return () => {
      cancelled = true
    }
  }, [queue])

  const openCount = rows?.filter((r) => r.status === 'open').length ?? 0

  return (
    <div className="erp-page">
      <div className="list-head">
        <h1>{QUEUE_LABEL[queue]}</h1>
        {rows && (
          <p className="muted">
            {rows.length} invoices · {openCount} open
          </p>
        )}
      </div>

      {error && (
        <div className="banner banner-error" role="alert">
          Could not load invoices: {error}
        </div>
      )}
      {!rows && !error && <p className="muted">Loading…</p>}

      {rows && (
        <table className="table queue-table">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Supplier</th>
              <th>Description</th>
              <th className="num">Amount</th>
              <th>Cost center</th>
              <th>Due date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => navigate(`/erp/invoices/${r.id}`)}>
                <td className="strong">
                  <Link to={`/erp/invoices/${r.id}`} onClick={(e) => e.stopPropagation()}>
                    {r.id}
                  </Link>
                </td>
                <td>
                  {r.supplier.name}
                  {!r.supplier.known && <VendorBadge />}
                </td>
                <td>{r.description}</td>
                <td className="num strong">{formatEur(r.amount)}</td>
                <td>{r.costCenter}</td>
                <td>{formatDate(r.dueDate)}</td>
                <td>
                  <StatusChip status={r.status} routeTo={r.routeTo} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
