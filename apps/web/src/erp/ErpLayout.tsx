import { useCallback, useEffect, useState } from 'react'
import { Link, Outlet, useSearchParams } from 'react-router-dom'
import { erpApi } from './erpApi.ts'
import { QUEUE_LABEL, SANDBOX_CLOCK, SANDBOX_PERIOD } from './format.ts'
import './erp.css'

/** Window A chrome: fixed sandbox header, page outlet, small rehearsal footer (queues + reset). */
export function ErpLayout() {
  const [params, setParams] = useSearchParams()
  const resetParam = params.get('reset') === '1'
  const [resetting, setResetting] = useState(resetParam)
  const [resetError, setResetError] = useState<string | null>(null)
  // Bumped after a reset so the current page remounts and refetches.
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    document.title = 'Sandbox ERP'
  }, [])

  const reset = useCallback(async () => {
    setResetting(true)
    try {
      await erpApi.reset()
      setResetError(null)
    } catch (err) {
      setResetError((err as Error).message)
    } finally {
      setResetting(false)
      setEpoch((n) => n + 1)
    }
  }, [])

  // /erp?reset=1 restores the seed state, then drops the param.
  useEffect(() => {
    if (!resetParam) return
    void reset().then(() =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('reset')
          return next
        },
        { replace: true },
      ),
    )
  }, [resetParam, reset, setParams])

  return (
    <div className="erp">
      <header className="erp-topbar">
        <div className="erp-brand">
          <span className="erp-logo">AP</span> Sandbox ERP · Accounts Payable
        </div>
        <div className="erp-period">{SANDBOX_PERIOD}</div>
        <div className="erp-clock">{SANDBOX_CLOCK}</div>
      </header>

      <main className="erp-main">
        {resetError && (
          <div className="banner banner-error" role="alert">
            Reset failed: {resetError}
          </div>
        )}
        {resetting ? <p className="muted">Resetting sandbox…</p> : <Outlet key={epoch} />}
      </main>

      <footer className="erp-footer">
        <Link to="/erp?queue=expert">{QUEUE_LABEL.expert}</Link>
        <Link to="/erp?queue=trainee">{QUEUE_LABEL.trainee}</Link>
        <button type="button" className="linkish" onClick={() => void reset()} disabled={resetting}>
          Reset sandbox
        </button>
      </footer>
    </div>
  )
}
