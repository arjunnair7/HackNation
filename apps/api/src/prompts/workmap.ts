// BUILD_PLAN §7.4: map builder (MAP_MODEL, tool build_work_map) plus the small apply_answer and
// apply_correction calls (tool update_work_map).
import type { GuardrailKind } from '@apprentice/shared';
import type { ToolDef } from '../llm/anthropic.service';

/** BUILD_PLAN §5: the only variables JSONLogic rules may use. */
export const ERP_CONTEXT_TS = `interface ErpContext {
  invoice: { id: string; amount: number; currency: 'EUR'; category: 'equipment'|'consumables'|'services';
             month: number; supplier: { id: string; name: string; country: string;
             known: boolean; isSubsidiary: boolean }; poAssetNumber?: string };
  draft:   { costCenter: string; assetNumber?: string; action?: 'approve'|'hold'|'route';
             routeTo?: 'controller'|'intercompany'; comment?: string };
}`;

const KINDS = `Guardrail kinds: limit = an amount or threshold; stop_and_ask = hold, route or ask someone before going on; never = something never to do; exception = when the usual way does not apply; rule = anything else that must always hold.`;

export const MAP_BUILDER_PROMPT = `Build a Work Map of how this expert does the task, so a new hire could do it alone.
- Steps: the real sequence, generalized across the invoices (e.g. "Check supplier history for known billing issues"), each tied to the screen moment where it was best seen (t, frameId).
- Mark judgmentCall=true when the expert deviated from a default or chose between options.
- reason.quote MUST be the expert's own words from the transcript or answers, verbatim, with its t. Never write a quote the expert did not say. If no reason exists, leave reason empty.
- Guardrails: limits, exceptions, stop-and-ask moments and never-rules, each with the expert's quote and t.
- For each guardrail write violatedWhen as JSONLogic over the ErpContext variables, evaluated as if draft.action were about to be saved (true = violation). For each judgment-call step write appliesWhen as JSONLogic (true = this step matters for this invoice). Only use variables that exist in ErpContext.
- openQuestions: at least 3 questions NOT answered during the task, prioritized: (1) judgment calls with no reason, (2) vague rules ("big invoices"), (3) unseen cases and boundaries (exactly €5,000? every supplier in December? who releases a hold?), (4) who to ask and how. Each with a one-line "why" it matters.

Input format and references:
- Expert speech and recorded answers come with ids ([u_…] utterance, [a_…] answer). Every quote carries quoteRef = the id it was copied from. Agent lines are context only and never a quote.
- Screen events come with their time and frame id. A screenMoment must use a frame id from the events.
- JSONLogic uses {"var": "invoice.amount"} style paths, e.g. {"and": [{"==": [{"var": "invoice.category"}, "equipment"]}, {">": [{"var": "invoice.amount"}, 5000]}, {"!=": [{"var": "draft.costCenter"}, "0400"]}]}.
- Ids: steps s1, s2, …; guardrails g1, g2, …; open questions q1, q2, …
${KINDS}`;

export const APPLY_ANSWER_PROMPT = `You maintain a Work Map of how an expert does a task. The expert just answered one of the open questions. Update the steps and guardrails so the map reflects the answer:
- Add a reason to the related step, sharpen a vague rule into a concrete one, or add a new guardrail (limit, exception, stop-and-ask, never-rule) when the answer states one.
- Quotes must be the expert's verbatim words with quoteRef = the answer id (or an earlier source id they came from). Never invent a quote.
- Keep every existing id; give new items the next free id (s…, g…). Keep everything the answer does not touch unchanged.
- Rules (violatedWhen, appliesWhen) are JSONLogic over the ErpContext variables only.
${KINDS}
Return the complete updated steps and guardrails.`;

export const APPLY_CORRECTION_PROMPT = `You maintain a Work Map of how an expert does a task. During the teach-back the expert corrected your explanation. Update the steps and guardrails so the map says what the expert says.
- Change only what the correction is about; keep every other item and every existing id.
- Quotes stay the expert's verbatim words with their quoteRef; the correction itself is quoteRef "correction".
- If the correction gives the reason for a step, that step's reason becomes the correction's words (quoteRef "correction"); never leave a step without the reason it had unless the correction contradicts it.
- Rules (violatedWhen, appliesWhen) are JSONLogic over the ErpContext variables only.
${KINDS}
Return the complete updated steps and guardrails.`;

const SCREEN_MOMENT = {
  type: 'object',
  required: ['t', 'frameId'],
  properties: { t: { type: 'number' }, frameId: { type: 'string' }, entity: { type: 'string' }, field: { type: 'string' } },
};

const QUOTE = {
  type: 'object',
  required: ['quote', 'quoteRef'],
  properties: {
    quote: { type: 'string', description: "The expert's own words, verbatim." },
    quoteRef: { type: 'string', description: 'Id of the utterance (u_…) or answer (a_…) the quote is copied from.' },
  },
};

const STEPS = {
  type: 'array',
  items: {
    type: 'object',
    required: ['id', 'title', 'decision', 'judgmentCall', 'screenMoment', 'guardrailIds'],
    properties: {
      id: { type: 'string' },
      title: { type: 'string', description: 'Generalized step, e.g. "Code the invoice to a cost center".' },
      decision: { type: 'string', description: 'What the expert decided, e.g. "Re-coded from opex (4711) to capex (0400)".' },
      judgmentCall: { type: 'boolean' },
      screenMoment: SCREEN_MOMENT,
      reason: { ...QUOTE, description: 'Only when the expert gave a reason.' },
      guardrailIds: { type: 'array', items: { type: 'string' } },
      appliesWhen: { type: 'object', description: 'JSONLogic over ErpContext (judgment calls only): true = this step matters for the invoice.' },
    },
  },
};

const GUARDRAILS = {
  type: 'array',
  items: {
    type: 'object',
    required: ['id', 'kind', 'text', 'quote', 'quoteRef'],
    properties: {
      id: { type: 'string' },
      kind: { type: 'string', enum: ['limit', 'exception', 'stop_and_ask', 'never', 'rule'] },
      text: { type: 'string', description: 'The rule in a few words, e.g. "No asset number, no capex booking".' },
      quote: { type: 'string', description: "The expert's own words, verbatim." },
      quoteRef: { type: 'string' },
      screenMoment: { type: 'object', properties: { t: { type: 'number' }, frameId: { type: 'string' } } },
      violatedWhen: { type: 'object', description: 'JSONLogic over ErpContext, as if draft.action were being saved: true = violation.' },
    },
  },
};

export const BUILD_WORK_MAP_TOOL: ToolDef = {
  name: 'build_work_map',
  description: 'Return the Work Map: steps, guardrails and open questions.',
  input_schema: {
    type: 'object',
    required: ['steps', 'guardrails', 'openQuestions'],
    properties: {
      steps: STEPS,
      guardrails: GUARDRAILS,
      openQuestions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'question', 'why'],
          properties: {
            id: { type: 'string' },
            question: { type: 'string', description: "Short, in the expert's own terms." },
            why: { type: 'string', description: 'One line: why it matters.' },
            relatedStepId: { type: 'string' },
          },
        },
      },
    },
  },
};

export const UPDATE_WORK_MAP_TOOL: ToolDef = {
  name: 'update_work_map',
  description: 'Return the complete updated steps and guardrails.',
  input_schema: { type: 'object', required: ['steps', 'guardrails'], properties: { steps: STEPS, guardrails: GUARDRAILS } },
};

// --- raw tool output -------------------------------------------------------------

export interface RawQuote { quote: string; quoteRef: string }
export interface RawStep {
  id: string; title: string; decision: string; judgmentCall: boolean;
  screenMoment: { t: number; frameId: string; entity?: string; field?: string };
  reason?: RawQuote; guardrailIds: string[]; appliesWhen?: object;
}
export interface RawGuardrail {
  id: string; kind: GuardrailKind; text: string; quote: string; quoteRef: string;
  screenMoment?: { t: number; frameId: string }; violatedWhen?: object;
}
export interface RawOpenQuestion { id: string; question: string; why: string; relatedStepId?: string }
export interface BuildWorkMapResult { steps: RawStep[]; guardrails: RawGuardrail[]; openQuestions: RawOpenQuestion[] }
export interface UpdateWorkMapResult { steps: RawStep[]; guardrails: RawGuardrail[] }
