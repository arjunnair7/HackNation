import type { Moment, ScreenEvent } from '@apprentice/shared'
import { formatT } from '../lib/clock.ts'

/** Contextual update for one screen event: "[SCREEN 03:12] Cost center on INV-4471 changed 4711 → 0400". */
export function screenCue(event: ScreenEvent): string {
  return `[SCREEN ${formatT(event.t)}] ${event.description}`
}

/**
 * [ASK_NOW] with 1–3 candidates; the agent picks one and asks about it.
 * The instruction rides inside the cue: in live sessions the agent skipped bare [ASK_NOW] cues
 * whenever the expert had already opened the next invoice ("she's still working").
 */
export function askNowCue(candidates: Moment[], expertName: string): string {
  const lines = candidates.map((c) => `- id=${c.id} (${c.suggestedType}) ${c.summary}`).join('\n')
  return (
    `[ASK_NOW] ${expertName} has paused: the app checked the screen is still and she is silent. ` +
    'Ask her ONE short question now, out loud, about one of these moments, even if she has already moved on ' +
    `to another invoice (name the invoice). Do not call skip_turn, and do not call record_answer until she has answered.\n${lines}`
  )
}

/** Sent once if the agent stays silent after [ASK_NOW]. */
export function askNowReminder(candidates: Moment[], expertName: string): string {
  return `[ASK_NOW] Reminder: ${expertName} is still waiting quietly. Ask your one question about these moments now, out loud.\n${candidates
    .map((c) => `- id=${c.id} (${c.suggestedType}) ${c.summary}`)
    .join('\n')}`
}

export type CueChannel = 'message' | 'context'

/** Debug drawer presets (the moment detector sends real [ASK_NOW] cues). */
export const CUE_PRESETS: { label: string; text: string; channel: CueChannel }[] = [
  {
    label: 'ASK_NOW',
    text: '[ASK_NOW] Sabine has paused: the app checked the screen is still and she is silent. Ask her ONE short question now, out loud, about one of these moments, even if she has already moved on to another invoice (name the invoice). Do not call skip_turn.\n- id=m_demo1 (LIMIT) Moved INV-4471 from cost center 4711 to 0400',
    channel: 'message',
  },
  {
    label: 'DEBRIEF',
    text: '[DEBRIEF] Open questions:\n- id=q_demo1 You held the December Brandt invoice. Is that for every supplier, and who releases the hold?',
    channel: 'message',
  },
  { label: 'TEACHBACK', text: '[TEACHBACK] (the compact work map goes here in Phase 6)', channel: 'message' },
  { label: 'BACK_ON_RECORD', text: '[BACK_ON_RECORD]', channel: 'context' },
]
