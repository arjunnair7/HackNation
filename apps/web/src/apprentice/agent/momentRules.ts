import type { Moment } from '@apprentice/shared'

/** Q1 "when to ask" (BUILD_PLAN Phase 4). The app decides when; the agent decides what. */
export const RULES = {
  tickMs: 250,
  vadThreshold: 0.5, // vad_score above this counts as the expert talking
  talkingWindowMs: 1500,
  screenBusyMs: 2500,
  minGapMs: 45_000, // between questions
  maxQuestions: 5, // per session
  minScore: 0.6,
  maxCandidates: 3,
  awaitAnswerMs: 30_000, // give up waiting for record_answer after this
  reminderAfterMs: 6000, // re-send [ASK_NOW] once if the agent hasn't started speaking by then
}

const GUARDRAIL_TYPES = new Set<Moment['suggestedType']>(['STOP', 'LIMIT', 'NEVER'])

export interface DetectorInput {
  now: number
  expertName: string
  connected: boolean
  agentSpeaking: boolean
  awaitingAnswer: boolean
  offRecord: boolean
  lastScreenChangeAt: number
  lastVoiceAt: number
  askedCount: number
  lastQuestionAt: number // 0 = no question yet
  moments: Moment[]
}

export interface Decision {
  ask: boolean
  candidates: Moment[]
  expertTalking: boolean
  screenBusy: boolean
  agentBusy: boolean
  nextQuestionInMs: number
  waiting: string // "Why I'm waiting"
}

export function decide(i: DetectorInput): Decision {
  const expertTalking = i.now - i.lastVoiceAt < RULES.talkingWindowMs
  const screenBusy = i.now - i.lastScreenChangeAt < RULES.screenBusyMs
  const agentBusy = i.agentSpeaking || i.awaitingAnswer
  const nextQuestionInMs = i.lastQuestionAt ? Math.max(0, RULES.minGapMs - (i.now - i.lastQuestionAt)) : 0
  const candidates = pickCandidates(i.moments)
  const checking = i.moments.some((m) => m.status === 'pending' && m.score >= RULES.minScore && !m.narrationChecked)

  const waiting = !i.connected
    ? 'Agent not connected'
    : i.offRecord
      ? 'Off the record'
      : i.agentSpeaking
        ? 'I am speaking'
        : i.awaitingAnswer
          ? `Waiting for ${i.expertName}'s answer`
          : expertTalking
            ? `${i.expertName} is talking`
            : screenBusy
              ? `${i.expertName} is working on screen`
              : candidates.length === 0
                ? checking
                  ? `Checking whether ${i.expertName} already explained it`
                  : 'Nothing worth asking yet'
                : i.askedCount >= RULES.maxQuestions
                  ? 'Question budget used up (rest goes to the debrief)'
                  : nextQuestionInMs > 0
                    ? `Pacing: next question in ${Math.ceil(nextQuestionInMs / 1000)} s`
                    : 'Asking now'

  return { ask: waiting === 'Asking now', candidates, expertTalking, screenBusy, agentBusy, nextQuestionInMs, waiting }
}

/** Pending, already-checked, not narrated, score ≥ 0.6; best first, then most recent; at most 3. */
export function pickCandidates(moments: Moment[]): Moment[] {
  const eligible = moments
    .filter((m) => m.status === 'pending' && m.narrationChecked && !m.coveredByNarration && m.score >= RULES.minScore)
    .sort((a, b) => b.score - a.score || b.t - a.t)
  // At least one question per session must be STOP / LIMIT / NEVER: until one is answered, lead with one.
  const guardrailAnswered = moments.some((m) => m.status === 'answered' && GUARDRAIL_TYPES.has(m.suggestedType))
  const lead = guardrailAnswered ? -1 : eligible.findIndex((m) => GUARDRAIL_TYPES.has(m.suggestedType))
  if (lead > 0) eligible.unshift(...eligible.splice(lead, 1))
  return eligible.slice(0, RULES.maxCandidates)
}
