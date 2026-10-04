import type { ReactNode } from 'react'

export interface ReadyStep {
  label: string
  detail?: ReactNode
  done: boolean
  action?: { label: string; onClick: () => void; disabled?: boolean }
}

/** A short checklist before a session; the next open step gets the primary button. */
export function GetReady({ title, steps, note }: { title: string; steps: ReadyStep[]; note?: ReactNode }) {
  const next = steps.findIndex((s) => !s.done)
  return (
    <section className="appr-card ready">
      <h2>{title}</h2>
      <ol className="ready-steps">
        {steps.map((step, i) => (
          <li key={step.label} className={step.done ? 'ready-done' : i === next ? 'ready-next' : undefined}>
            <span className="ready-num" aria-hidden="true">
              {step.done ? '✓' : i + 1}
            </span>
            <div className="ready-text">
              <strong>{step.label}</strong>
              {step.detail && <div className="appr-small">{step.detail}</div>}
            </div>
            {step.action && !step.done && (
              <button
                type="button"
                className={`appr-btn${i === next ? ' appr-btn-primary' : ''}`}
                onClick={step.action.onClick}
                disabled={step.action.disabled}
              >
                {step.action.label}
              </button>
            )}
          </li>
        ))}
      </ol>
      {note && <p className="appr-small ready-note">{note}</p>}
    </section>
  )
}
