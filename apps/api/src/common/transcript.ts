import type { Utterance } from '@apprentice/shared';

/** The expert's words after the agent's most recent question, up to the agent's next turn. */
export function answerAfterLastQuestion(transcript: Utterance[]): string | undefined {
  let q = -1;
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i].speaker === 'agent' && transcript[i].text.includes('?')) {
      q = i;
      break;
    }
  }
  if (q < 0) return undefined;
  const lines: string[] = [];
  for (const u of transcript.slice(q + 1)) {
    if (u.speaker === 'agent') break;
    if (u.speaker === 'expert' && !u.offRecord) lines.push(u.text.trim());
  }
  return lines.length ? lines.join(' ') : undefined;
}
