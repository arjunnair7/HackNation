import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useMatch, useSearchParams } from 'react-router-dom'
import type { AgentPresence, ErpInvoiceSummary, ErpLayoutMessage } from '@apprentice/shared'
import { getSocket } from '../apprentice/lib/socket.ts'
import { SiriOrb } from '../components/SiriOrb.tsx'
import { Icon } from './components.tsx'
import { announceErpChange, erpApi } from './erpApi.ts'
import { QUEUE_LABEL, SANDBOX_CLOCK, SANDBOX_PERIOD, STATUS_VIEWS } from './format.ts'
import './erp.css'

const PRESENCE_TIMEOUT_MS = 3000
const ORB_STATE_LABEL: Record<AgentPresence['state'], string> = {
  off: 'Apprentice off',
  listening: 'Apprentice listening',
  speaking: 'Apprentice speaking',
  off_record: 'Off the record',
}

/** Window A chrome: dark sidebar (queues, status views, the apprentice's orb), top bar, page outlet. */
export function ErpLayout() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const resetParam = params.get('reset') === '1'
  const [resetting, setResetting] = useState(resetParam)
  const [resetError, setResetError] = useState<string | null>(null)
  const [epoch, setEpoch] = useState(0) // bumped after a reset so the page remounts and refetches
  const [all, setAll] = useState<ErpInvoiceSummary[]>([])
  const presence = usePresence()
  const orbRef = useReportOrbLayout()

  useEffect(() => {
    document.title = 'Sandbox ERP'
  }, [])

  const refreshCounts = useCallback(() => {
    erpApi.listInvoices().then(setAll, () => {})
  }, [])
  useEffect(refreshCounts, [refreshCounts, location.key, epoch])
  useEffect(() => {
    window.addEventListener('erp:changed', refreshCounts)
    return () => window.removeEventListener('erp:changed', refreshCounts)
  }, [refreshCounts])

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
      announceErpChange()
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

  const openCount = (queue: 'expert' | 'trainee') => all.filter((r) => r.queue === queue && r.status === 'open').length
  const statusCount = (status: string) => all.filter((r) => r.status === status).length
  const onList = location.pathname === '/erp' || location.pathname === '/erp/'
  const activeQueue = onList && !params.get('status') ? (params.get('queue') === 'trainee' ? 'trainee' : 'expert') : null
  const activeStatus = onList ? params.get('status') : null
  const detailId = useMatch('/erp/invoices/:invoiceId')?.params.invoiceId
  const detailQueue = all.find((r) => r.id === detailId)?.queue
  const listTitle = STATUS_VIEWS.find((v) => v.status === activeStatus)?.label ?? QUEUE_LABEL[activeQueue ?? 'expert']

  return (
    <>
      <div className="erp">
        <aside className="erp-side">
          <div className="erp-brand">
            <span className="erp-logo" aria-hidden="true">
              ◆
            </span>
            <span>
              <strong>Sandbox ERP</strong>
              <span>Accounts Payable</span>
            </span>
          </div>

          <nav className="side-nav" aria-label="Queues">
            <span className="side-title">Inbox</span>
            {(['expert', 'trainee'] as const).map((q) => (
              <Link key={q} to={`/erp?queue=${q}`} className={`side-link${activeQueue === q ? ' side-active' : ''}`}>
                <Icon name="user" />
                <span>{QUEUE_LABEL[q]}</span>
                <span className="side-count">{openCount(q)}</span>
              </Link>
            ))}
            <span className="side-title">Status</span>
            {STATUS_VIEWS.map((v) => (
              <Link key={v.status} to={`/erp?status=${v.status}`} className={`side-link${activeStatus === v.status ? ' side-active' : ''}`}>
                <Icon name={v.status === 'posted' ? 'check' : v.status === 'on_hold' ? 'pause' : 'route'} />
                <span>{v.label}</span>
                <span className="side-count">{statusCount(v.status)}</span>
              </Link>
            ))}
          </nav>

          <button type="button" className="side-reset" onClick={() => void reset()} disabled={resetting}>
            <Icon name="reset" size={15} /> Reset sandbox
          </button>
        </aside>

        <div className="erp-body">
          <header className="erp-topbar">
            <nav className="crumbs" aria-label="Breadcrumb">
              {detailId ? (
                <>
                  {detailQueue ? <Link to={`/erp?queue=${detailQueue}`}>← {QUEUE_LABEL[detailQueue]}</Link> : <Link to="/erp">← Queue</Link>}
                  <span className="crumb-sep">/</span>
                  <span>{detailId}</span>
                </>
              ) : (
                <>
                  <span className="crumb-muted">Accounts Payable</span>
                  <span className="crumb-sep">/</span>
                  <span>{listTitle}</span>
                </>
              )}
            </nav>
            <span className="topbar-right">
              <span className="period-chip">
                <Icon name="calendar" size={16} /> {SANDBOX_PERIOD}
              </span>
              <span className="erp-clock">{SANDBOX_CLOCK}</span>
            </span>
          </header>
          <main className="erp-main">
            {resetError && (
              <div className="banner banner-error" role="alert">
                Reset failed: {resetError}
              </div>
            )}
            {resetting ? <p className="muted">Resetting sandbox…</p> : <Outlet key={epoch} />}
          </main>
        </div>
      </div>

      {/* Outside .erp (which turns animation off) and masked out of what vision sees: the apprentice
          window gets this box via erp_layout. Always rendered so the box never moves. */}
      <div className="erp-orb" ref={orbRef} aria-live="polite">
        {presence.state !== 'off' && (
          <>
            <SiriOrb state={presence.state} level={presence.level} size={48} />
            <span className={`erp-orb-label erp-orb-${presence.state}`}>{ORB_STATE_LABEL[presence.state]}</span>
          </>
        )}
      </div>
    </>
  )
}

/** The apprentice window's state (relayed over socket.io); "off" after a few quiet seconds. */
function usePresence(): AgentPresence {
  const [presence, setPresence] = useState<AgentPresence>({ state: 'off', level: 0 })
  const lastSeen = useRef(0)
  useEffect(() => {
    const socket = getSocket()
    const onPresence = (p: AgentPresence) => {
      lastSeen.current = Date.now()
      setPresence(p)
    }
    socket.on('agent_presence', onPresence)
    const timer = setInterval(() => {
      if (Date.now() - lastSeen.current > PRESENCE_TIMEOUT_MS) setPresence((p) => (p.state === 'off' ? p : { state: 'off', level: 0 }))
    }, 1000)
    return () => {
      socket.off('agent_presence', onPresence)
      clearInterval(timer)
    }
  }, [])
  return presence
}

/** Tells the apprentice window where the orb box is (on load, resize and every few seconds). */
function useReportOrbLayout() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const socket = getSocket()
    const windowId = Math.random().toString(36).slice(2, 10)
    const report = () => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      const message: ErpLayoutMessage = {
        windowId,
        dpr: window.devicePixelRatio || 1,
        mask: { x: r.left, y: r.top, w: r.width, h: r.height },
        viewport: { w: window.innerWidth, h: window.innerHeight },
      }
      socket.emit('erp_layout', message)
    }
    report()
    const timer = setInterval(report, 3000)
    window.addEventListener('resize', report)
    socket.on('connect', report)
    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', report)
      socket.off('connect', report)
    }
  }, [])
  return ref
}
