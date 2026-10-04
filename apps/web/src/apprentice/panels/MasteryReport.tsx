import type { MasteryRecord, WorkMap } from '@apprentice/shared'
import { KIND_LABEL } from '../lib/mapReplay.ts'

type StepStatus = 'mastered' | 'hint' | 'caught' | 'untested'
type GuardrailStatus = 'fixed' | 'caught' | 'untested'

const STEP_LABEL: Record<StepStatus, string> = {
  mastered: 'Mastered ✓',
  hint: 'Needed a hint',
  caught: 'Caught by a guardrail',
  untested: 'Not practised yet',
}
const GUARDRAIL_LABEL: Record<GuardrailStatus, string> = {
  fixed: 'Caught, fixed after the hint',
  caught: 'Caught by the guardrail',
  untested: 'Not triggered',
}

interface Props {
  map: WorkMap
  mastery: MasteryRecord[]
  expertName: string
  traineeName: string
}

/** Q4 "did the new hire learn": per step and guardrail, then what to practise next. */
export function MasteryReport({ map, mastery, expertName, traineeName }: Props) {
  const steps = map.steps.filter((s) => !map.struck.includes(s.id))
  const guardrails = map.guardrails.filter((g) => !map.struck.includes(g.id))
  const stepStatus = (id: string): StepStatus => {
    const mine = mastery.filter((r) => r.stepId === id)
    if (mine.some((r) => r.kind === 'prediction' && r.correct === false)) return 'hint'
    if (mine.some((r) => (r.kind === 'prediction' && r.correct) || r.kind === 'clean')) return 'mastered'
    if (mine.some((r) => r.kind === 'guardrail_caught')) return 'caught'
    return 'untested'
  }
  const guardrailStatus = (id: string): GuardrailStatus => {
    const mine = mastery.filter((r) => r.guardrailId === id)
    if (mine.some((r) => r.kind === 'fixed_after_hint')) return 'fixed'
    if (mine.some((r) => r.kind === 'guardrail_caught')) return 'caught'
    return 'untested'
  }
  const predictions = mastery.filter((r) => r.kind === 'prediction')
  const invoices = new Set(mastery.map((r) => r.invoiceId).filter(Boolean))
  const practise = [
    ...steps.filter((s) => stepStatus(s.id) === 'hint').map((s) => s.title),
    ...guardrails.filter((g) => guardrailStatus(g.id) !== 'untested').map((g) => g.text),
    ...steps.filter((s) => s.judgmentCall && stepStatus(s.id) === 'untested').map((s) => s.title),
  ]

  return (
    <section className="appr-card mastery">
      <div className="card-head">
        <h2>Mastery report</h2>
        <span className="appr-small">
          {traineeName}, learning from {expertName}
        </span>
      </div>
      <p className="workmap-summary">
        {invoices.size} invoice{invoices.size === 1 ? '' : 's'} · predictions {predictions.filter((p) => p.correct).length}/{predictions.length} right ·{' '}
        {mastery.filter((r) => r.kind === 'guardrail_caught').length} guardrail catch(es) before save
      </p>

      <h3>Steps</h3>
      <ul className="mastery-list">
        {steps.map((s) => {
          const status = stepStatus(s.id)
          return (
            <li key={s.id} className={`mastery-${status}`}>
              <span>{s.title}</span>
              <strong>{STEP_LABEL[status]}</strong>
            </li>
          )
        })}
      </ul>

      <h3>Guardrails</h3>
      <ul className="mastery-list">
        {guardrails.map((g) => {
          const status = guardrailStatus(g.id)
          return (
            <li key={g.id} className={`mastery-${status}`}>
              <span>
                <span className={`chip-kind kind-${g.kind}`}>{KIND_LABEL[g.kind]}</span> {g.text}
              </span>
              <strong>{GUARDRAIL_LABEL[status]}</strong>
            </li>
          )
        })}
      </ul>

      <p className="practise">
        <strong>Practise next:</strong> {practise.length ? practise.slice(0, 3).join(' · ') : `nothing flagged; try more of ${expertName}'s invoices.`}
      </p>
    </section>
  )
}
