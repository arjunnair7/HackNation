import type { MasteryRecord, WorkMap } from '@apprentice/shared'
import { formatT } from '../lib/clock.ts'
import { KIND_LABEL } from '../lib/mapReplay.ts'

export interface TutorAlert {
  id: number
  kind: 'risk' | 'blocked' | 'resolved'
  invoiceId: string
  guardrailId: string
  t?: number
}

export interface TutorCueState {
  text: string
  type: string
  invoiceId: string
  status: 'waiting' | 'sent' | 'expired'
  t?: number
}

interface Props {
  map: WorkMap
  expertName: string
  traineeName: string
  invoice: { id: string; label: string } | null
  cue: TutorCueState | null
  alerts: TutorAlert[]
  mastery: MasteryRecord[]
  ended: boolean
  onEndTraining: () => void
}

const ALERT_LABEL = { risk: 'risk', blocked: 'save blocked', resolved: 'fixed ✓' } as const

/** What the tutor is doing: the invoice in front of the trainee, the next cue, guardrail catches, predictions. */
export function TutorPanel({ map, expertName, traineeName, invoice, cue, alerts, mastery, ended, onEndTraining }: Props) {
  const guardrail = (id: string) => map.guardrails.find((g) => g.id === id)
  const step = (id?: string) => map.steps.find((s) => s.id === id)
  const predictions = mastery.filter((r) => r.kind === 'prediction')
  return (
    <section className="appr-card tutor">
      <div className="card-head">
        <h2>Tutor</h2>
        {!ended && (
          <button type="button" className="appr-btn appr-btn-small" onClick={onEndTraining}>
            End training
          </button>
        )}
      </div>
      <p className="appr-small">
        Teaching {traineeName} from {expertName}'s map v{map.version}: {map.steps.length} steps, {map.guardrails.length} guardrails. Save gate{' '}
        {ended ? 'off' : 'on'}.
      </p>

      <div className="tutor-grid">
        <div className="signal">
          <span className="signal-label">Invoice open</span>
          <strong>{invoice ? invoice.label : 'none yet: open one from the trainee queue'}</strong>
        </div>
        <div className="signal">
          <span className="signal-label">Next cue</span>
          <strong>
            {cue
              ? `${cue.type} ${cue.status === 'waiting' ? '(waiting for a quiet moment)' : cue.status === 'sent' ? `sent at ${formatT(cue.t ?? 0)}` : '(expired)'}`
              : '—'}
          </strong>
        </div>
      </div>

      <h3>Guardrails</h3>
      {alerts.length ? (
        <ul className="tutor-alerts">
          {[...alerts].reverse().map((a) => {
            const g = guardrail(a.guardrailId)
            return (
              <li key={a.id} className={`alert-${a.kind}`}>
                <span className="feed-time">{a.t === undefined ? '' : formatT(a.t)}</span>
                <span>
                  {a.invoiceId} · {g ? `${KIND_LABEL[g.kind]}: ${g.text}` : a.guardrailId}
                </span>
                <strong>{ALERT_LABEL[a.kind]}</strong>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="appr-muted">No guardrail touched yet.</p>
      )}

      <h3>Predictions</h3>
      {predictions.length ? (
        <ul className="tutor-alerts">
          {predictions.map((p, i) => (
            <li key={i} className={p.correct ? 'alert-resolved' : 'alert-risk'}>
              <span className="feed-time">{formatT(p.t)}</span>
              <span>
                {p.invoiceId} · {step(p.stepId)?.title ?? p.stepId}
              </span>
              <strong>{p.correct ? 'right ✓' : 'wrong'}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="appr-muted">None yet.</p>
      )}
    </section>
  )
}
