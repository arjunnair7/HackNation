import { useEffect, useRef } from 'react'
import type { ScreenEventsMessage } from '@apprentice/shared'
import { api } from '../lib/api.ts'

interface Props {
  sessionId?: string
  sharing: boolean
  stream: MediaStream | null
  diff: number
  threshold: number
  lastChangeAt: number
  framesSent: number
  lastVision: ScreenEventsMessage | null
  onShare: () => void
  onStopSharing: () => void
}

/** Share controls, live preview, change-detection meter and the last vision result. */
export function CapturePanel(props: Props) {
  const { sessionId, sharing, stream, diff, threshold, lastChangeAt, framesSent, lastVision } = props
  const preview = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (preview.current) preview.current.srcObject = stream
  }, [stream])

  // Same rule the moment detector uses in Phase 4: busy if the screen changed in the last 2.5 s.
  const busy = sharing && Date.now() - lastChangeAt < 2500
  const meter = Math.min(1, diff / (2 * threshold)) // the threshold sits at the middle of the bar

  return (
    <section className="appr-card">
      <div className="card-head">
        <h2>Screen</h2>
        {sharing ? (
          <button type="button" className="appr-btn" onClick={props.onStopSharing}>
            Stop sharing
          </button>
        ) : (
          <button type="button" className="appr-btn appr-btn-primary" onClick={props.onShare} disabled={!sessionId}>
            Share ERP window
          </button>
        )}
      </div>

      {!sessionId && <p className="appr-muted">Start the session first, then share the ERP window.</p>}
      {sessionId && !sharing && (
        <p className="appr-muted">
          In the picker choose <strong>Window → Sandbox ERP</strong>, never this panel.
        </p>
      )}

      {sharing && (
        <div className="capture-grid">
          <video ref={preview} className="capture-preview" autoPlay muted playsInline />
          <div className="capture-stats">
            <div className={`pill ${busy ? 'pill-busy' : 'pill-quiet'}`}>{busy ? 'Screen busy' : 'Screen quiet'}</div>
            <div className="meter" title={`diff ${diff.toFixed(5)} / threshold ${threshold}`}>
              <div className="meter-fill" style={{ width: `${meter * 100}%` }} />
              <div className="meter-mark" />
            </div>
            <div className="appr-small">
              diff {diff.toFixed(5)} · threshold {threshold}
            </div>
            <div className="appr-small">Frames sent: {framesSent}</div>
            {lastVision && sessionId && (
              <div className="appr-small">
                Last vision: {lastVision.screen}
                {lastVision.entity && ` · ${lastVision.entity}`} · {lastVision.events.length} event(s) ·{' '}
                {(lastVision.ms / 1000).toFixed(1)} s ·{' '}
                {lastVision.frameId !== 'debug' && (
                  <a href={api.frameUrl(sessionId, lastVision.frameId)} target="_blank" rel="noreferrer">
                    frame
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
