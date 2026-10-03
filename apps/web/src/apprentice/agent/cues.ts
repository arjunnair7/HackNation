import type { ScreenEvent } from '@apprentice/shared'
import { formatT } from '../lib/clock.ts'

/** Contextual update for one screen event: "[SCREEN 03:12] Cost center on INV-4471 changed 4711 → 0400". */
export function screenCue(event: ScreenEvent): string {
  return `[SCREEN ${formatT(event.t)}] ${event.description}`
}

export type CueChannel = 'message' | 'context'

/** Debug drawer presets. The app sends the real cues from Phase 4 on. */
export const CUE_PRESETS: { label: string; text: string; channel: CueChannel }[] = [
  {
    label: 'ASK_NOW',
    text: '[ASK_NOW]\n- id=m_demo1 (LIMIT) Moved INV-4471 from cost center 4711 to 0400',
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
