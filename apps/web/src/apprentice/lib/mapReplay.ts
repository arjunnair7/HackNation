import type { Guardrail, GuardrailKind, Session, Step, Utterance, WorkMap } from '@apprentice/shared'
import type { ReplayTarget } from '../panels/ReplayModal.tsx'
import { formatT } from './clock.ts'

export const KIND_LABEL: Record<GuardrailKind, string> = {
  limit: 'Limit',
  exception: 'Exception',
  stop_and_ask: 'Stop and ask',
  never: 'Never',
  rule: 'Rule',
}
export const SOURCE_LABEL = { live: 'live question', debrief: 'debrief', narration: 'said while working' } as const

/** The expert's on-record, unstruck lines. */
export function expertWords(session: Session | null): Utterance[] {
  if (!session) return []
  const struck = new Set(session.struck ?? [])
  return session.transcript.filter((u) => u.speaker === 'expert' && !u.offRecord && !struck.has(u.id))
}

/** A step's reason; maps drafted before answers took priority may label a debrief answer "said while working". */
export function reasonOf(step: Step, session: Session | null): Step['reason'] {
  if (!step.reason) return undefined
  const quote = step.reason.quote.toLowerCase()
  const answer = session?.answers.find((a) => a.source !== 'narration' && a.quote.toLowerCase().includes(quote))
  return answer ? { ...step.reason, source: answer.source, t: answer.t } : step.reason
}

/** A guardrail's screen moment; older maps may lack one, then the linked step's, else the frame nearest its quote. */
export function guardrailMoment(g: Guardrail, steps: Step[], frames: Session['frames']): { t: number; frameId: string } {
  if (g.screenMoment?.frameId) return g.screenMoment
  const step = steps.find((s) => s.guardrailIds.includes(g.id))
  if (step) return { t: step.screenMoment.t, frameId: step.screenMoment.frameId }
  const nearest = [...frames].sort((a, b) => Math.abs(a.t - g.t) - Math.abs(b.t - g.t))[0]
  return nearest ? { t: nearest.t, frameId: nearest.id } : { t: g.t, frameId: '' }
}

export function stepReplay(map: WorkMap, step: Step, session: Session | null): ReplayTarget {
  const live = map.steps.filter((s) => !map.struck.includes(s.id))
  const n = live.findIndex((x) => x.id === step.id) + 1
  const reason = reasonOf(step, session)
  return {
    kind: n ? `Step ${n}/${live.length}` : 'Step (removed)',
    title: step.title,
    moment: step.screenMoment,
    quote: reason ? { text: reason.quote, label: `${SOURCE_LABEL[reason.source]} at ${formatT(reason.t)}` } : undefined,
  }
}

export function guardrailReplay(map: WorkMap, g: Guardrail, session: Session | null): ReplayTarget {
  return {
    kind: `Guardrail · ${KIND_LABEL[g.kind]}`,
    title: g.text,
    moment: guardrailMoment(g, map.steps, session?.frames ?? []),
    quote: g.quote ? { text: g.quote, label: `said at ${formatT(g.t)}` } : undefined,
  }
}
