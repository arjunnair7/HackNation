import { Link, Navigate, createBrowserRouter, useParams } from 'react-router-dom'
import { ApprenticePage } from './apprentice/ApprenticePage.tsx'
import { ErpLayout } from './erp/ErpLayout.tsx'
import { InvoiceDetailPage } from './erp/InvoiceDetailPage.tsx'
import { InvoiceListPage } from './erp/InvoiceListPage.tsx'

// Remount per invoice so drafts, autosave timers and banners never leak between invoices.
function InvoiceDetailRoute() {
  const { invoiceId = '' } = useParams()
  return <InvoiceDetailPage key={invoiceId} invoiceId={invoiceId} />
}

function NotFound() {
  return (
    <main className="plain-page">
      <h1>Not found</h1>
      <p>
        Try <Link to="/erp">/erp</Link> or <Link to="/apprentice">/apprentice</Link>.
      </p>
    </main>
  )
}

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/erp" replace /> },
  {
    path: '/erp',
    element: <ErpLayout />,
    children: [
      { index: true, element: <InvoiceListPage /> },
      { path: 'invoices/:invoiceId', element: <InvoiceDetailRoute /> },
    ],
  },
  { path: '/apprentice', element: <ApprenticePage /> },
  { path: '*', element: <NotFound /> },
])
