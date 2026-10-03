import type { Moment } from '@apprentice/shared'
import { RULES } from '../agent/momentRules.ts'
import type { BrainState } from '../agent/useMomentDetector.ts'
import { formatT } from '../lib/clock.ts'

/** The live "apprentice brain": why it is waiting, the timing signals, the budget and the moment queue. */
export function BrainPanel({ brain, moments, expertName }: { brain: BrainState | null; moments: Moment[]; expertName: string }) {
  if (!brain) return null
  const queue = moments
    .filter((m) => m.status !== 'expired' || m.score >= RULES.minScore)
    .sort((a, b) => b.t - a.t)
    .slice(0, 8)
  const budgetNote =
    brain.askedCount >= RULES.maxQuestions
      ? 'used up'
      : brain.nextQuestionInMs > 0
        ? `next in ${Math.ceil(brain.nextQuestionInMs / 1000)} s`
        : 'ready'

  return (
    <section className="appr-card brain">
      <div className="brain-why">
        <span className="brain-why-label">Why I'm waiting</span>
        <strong className={brain.ask || brain.waiting === 'Asking now' ? 'brain-asking' : ''}>{brain.waiting}</strong>
      </div>

      <div className="brain-signals">
        <Signal label="Screen" value={brain.screenBusy ? 'busy' : 'quiet'} busy={brain.screenBusy} level={brain.screenLevel} />
        <Signal
          label={expertName}
          value={brain.expertTalking ? 'talking' : 'quiet'}
          busy={brain.expertTalking}
          level={brain.vadLevel}
          note={brain.vadSeen ? undefined : 'no voice signal yet'}
        />
        <Signal
          label="Agent"
          value={brain.agentSpeaking ? 'speaking' : brain.awaitingAnswer ? 'awaiting answer' : 'listening'}
          busy={brain.agentBusy}
        />
        <div className="signal">
          <span className="signal-label">Budget</span>
          <strong>
            {brain.askedCount}/{RULES.maxQuestions}
          </strong>
          <span className="signal-note">{budgetNote}</span>
        </div>
      </div>

      <h3>Moment queue</h3>
      {queue.length === 0 ? (
        <p className="appr-muted">Moments appear as {expertName} changes things on screen.</p>
      ) : (
        <table className="moments">
          <tbody>
            {queue.map((m) => (
              <tr key={m.id} className={m.score < RULES.minScore ? 'moment-low' : ''}>
                <td className="moment-t">{formatT(m.t)}</td>
                <td className="moment-score">{m.score.toFixed(2)}</td>
                <td>
                  <span className={`type type-${m.suggestedType}`}>{m.suggestedType}</span>
                </td>
                <td className="moment-summary">
                  <strong>{m.entity}</strong> {m.summary}
                  {m.coveredByNarration && <span className="tag tag-ok">narrated ✓</span>}
                </td>
                <td className="moment-status">{statusLabel(m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function statusLabel(m: Moment): string {
  if (m.score < RULES.minScore) return 'not worth asking'
  if (m.coveredByNarration) return 'skip'
  switch (m.status) {
    case 'pending':
      return m.narrationChecked ? 'queued' : 'checking'
    case 'offered':
      return 'offered'
    case 'asked':
      return 'asked'
    case 'answered':
      return 'answered ✓'
    case 'expired':
      return 'for debrief'
  }
}

function Signal({ label, value, busy, level, note }: { label: string; value: string; busy: boolean; level?: number; note?: string }) {
  return (
    <div className="signal">
      <span className="signal-label">{label}</span>
      <strong className={busy ? 'signal-busy' : 'signal-quiet'}>{value}</strong>
      {level !== undefined && (
        <div className="signal-bar">
          <div style={{ width: `${Math.round(Math.min(1, level) * 100)}%` }} />
        </div>
      )}
      {note && <span className="signal-note">{note}</span>}
    </div>
  )
}
