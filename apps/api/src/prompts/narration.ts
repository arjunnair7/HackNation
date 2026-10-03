// BUILD_PLAN §7.5: "Already narrated?" check (VISION_MODEL, used by MomentsService).
import type { ToolDef } from '../llm/anthropic.service';

export const NARRATION_PROMPT = `Given this screen event and the expert's speech from 15 s before to 5 s after it, did the expert already explain WHY? Answer {covered: boolean, quote?: string}.

The speech may include unrelated remarks; covered is true if any line gives the reason for this event.
quote must be the expert's own words, copied verbatim from the speech, and only when covered is true.`;

export const REPORT_NARRATION_TOOL: ToolDef = {
  name: 'report_narration',
  description: 'Report whether the expert already explained why they did what the screen event shows.',
  input_schema: {
    type: 'object',
    required: ['covered'],
    properties: {
      covered: { type: 'boolean', description: 'True if the speech already explains WHY.' },
      quote: { type: 'string', description: "The expert's explaining words, verbatim from the speech." },
    },
  },
};

export interface ReportNarrationResult {
  covered: boolean;
  quote?: string;
}
