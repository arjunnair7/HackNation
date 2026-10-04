import type { OpenQuestion, WorkMap } from '@apprentice/shared'

interface Props {
  map: WorkMap
  expertName: string
  onSkip: (question: OpenQuestion) => void
  onStartTeachback: () => void
}

/** Q3 "when has it understood": open questions closing, coverage, teach-back, and the Done badge. */
export function DebriefPanel({ map, expertName, onSkip, onStartTeachback }: Props) {
  const allResolved = map.openQuestions.every((q) => q.status !== 'open')
  const confirmed = map.teachback.status === 'confirmed'
  const done = allResolved && confirmed
  const { coverage } = map

  return (
    <section className="appr-card debrief">
      <div className="card-head">
        <h2>Debrief</h2>
        {done ? <span className="done-badge">Done ✓</span> : <span className="appr-small">v{map.version}</span>}
      </div>
      {!done && <p className="done-hint">{doneHint(map.openQuestions.filter((q) => q.status === 'open').length, confirmed)}</p>}

      <h3>Open questions</h3>
      <ul className="questions">
        {map.openQuestions.map((q) => (
          <li key={q.id} className={`question question-${q.status}`}>
            <span className="question-mark">{q.status === 'answered' ? '✓' : q.status === 'skipped' ? '–' : '○'}</span>
            <div>
              <div>{q.question}</div>
              {q.answerQuote ? (
                <div className="question-answer">"{q.answerQuote}"</div>
              ) : (
                <div className="appr-small">{q.why}</div>
              )}
            </div>
            {q.status === 'open' && (
              <button type="button" className="appr-btn appr-btn-small" onClick={() => onSkip(q)}>
                Skip
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="coverage">
        <Meter label="Steps with a reason" value={coverage.stepsWithReason} total={coverage.steps} />
        <Meter label="Guardrails with a source" value={coverage.guardrails === 0 ? 0 : coverage.guardrailsWithSource} total={coverage.guardrails} />
      </div>

      <div className="teachback">
        <div>
          <span className="signal-label">Teach-back</span>
          <strong className={`tb-${map.teachback.status}`}>
            {map.teachback.status === 'confirmed'
              ? `confirmed by ${expertName}`
              : map.teachback.status === 'corrected'
                ? `${map.teachback.corrections.length} correction(s), waiting for confirmation`
                : allResolved
                  ? 'ready'
                  : 'after the open questions'}
          </strong>
          {map.teachback.corrections.map((c, i) => (
            <div key={i} className="question-answer">
              Correction: "{c}"
            </div>
          ))}
        </div>
        {!confirmed && (
          <button type="button" className="appr-btn appr-btn-small" onClick={onStartTeachback}>
            Start teach-back now
          </button>
        )}
      </div>

    </section>
  )
}

/** What "Done" is still waiting for (Q3: every gap closed and the teach-back confirmed). */
function doneHint(openCount: number, confirmed: boolean): string {
  const questions = `${openCount} open question${openCount === 1 ? '' : 's'}`
  if (confirmed) return `Teach-back confirmed. Done once the ${questions} left ${openCount === 1 ? 'is' : 'are'} answered or skipped.`
  if (openCount) return `Done when the ${questions} ${openCount === 1 ? 'is' : 'are'} closed and the teach-back is confirmed.`
  return 'Done when the teach-back is confirmed.'
}

function Meter({ label, value, total }: { label: string; value: number; total: number }) {
  const share = total ? value / total : 0
  return (
    <div className="signal">
      <span className="signal-label">{label}</span>
      <strong>
        {value}/{total}
      </strong>
      <div className="signal-bar coverage-bar">
        <div style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
    </div>
  )
}
