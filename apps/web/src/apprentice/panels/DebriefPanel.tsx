import { useEffect, useRef, useState } from 'react'
import type { GuardrailKind, OpenQuestion, WorkMap } from '@apprentice/shared'

const KIND_LABEL: Record<GuardrailKind, string> = {
  limit: 'Limit',
  exception: 'Exception',
  stop_and_ask: 'Stop and ask',
  never: 'Never',
  rule: 'Rule',
}

interface Props {
  map: WorkMap
  expertName: string
  onSkip: (question: OpenQuestion) => void
  onStartTeachback: () => void
}

/** Q3 "when has it understood": open questions closing, coverage, teach-back, and the Done badge. */
export function DebriefPanel({ map, expertName, onSkip, onStartTeachback }: Props) {
  const changed = useChangedIds(map)
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

      <h3>
        Work Map draft · {map.steps.length} steps · {map.steps.filter((s) => s.judgmentCall).length} judgment calls ·{' '}
        {map.guardrails.length} guardrails
      </h3>
      <ol className="map-steps">
        {map.steps.map((s) => (
          <li key={s.id} className={changed.has(s.id) ? 'flash' : ''}>
            <strong>{s.title}</strong> {s.judgmentCall && <span className="type type-LIMIT">judgment call</span>}
            <div className="appr-small">{s.decision}</div>
            {s.reason && <div className="question-answer">"{s.reason.quote}"</div>}
          </li>
        ))}
      </ol>
      <ul className="map-guardrails">
        {map.guardrails.map((g) => (
          <li key={g.id} className={changed.has(g.id) ? 'flash' : ''}>
            <span className={`type type-${g.kind === 'stop_and_ask' ? 'STOP' : g.kind === 'never' ? 'NEVER' : 'LIMIT'}`}>{KIND_LABEL[g.kind]}</span>{' '}
            {g.text}
            {g.quote && <div className="question-answer">"{g.quote}"</div>}
          </li>
        ))}
      </ul>
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

/** Ids of steps and guardrails that changed in the latest update (they flash briefly). */
function useChangedIds(map: WorkMap): Set<string> {
  const previous = useRef<Map<string, string>>(new Map())
  const [changed, setChanged] = useState<Set<string>>(new Set())
  useEffect(() => {
    const next = new Map<string, string>()
    for (const item of [...map.steps, ...map.guardrails]) next.set(item.id, JSON.stringify(item))
    const diff = new Set<string>()
    if (previous.current.size) for (const [id, json] of next) if (previous.current.get(id) !== json) diff.add(id)
    previous.current = next
    setChanged(diff)
    if (!diff.size) return
    const timer = setTimeout(() => setChanged(new Set()), 2500)
    return () => clearTimeout(timer)
  }, [map])
  return changed
}
