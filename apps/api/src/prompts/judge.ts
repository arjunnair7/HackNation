// BUILD_PLAN Phase 8 LLM fallback: guardrails that have no violatedWhen rule are judged by MAP_MODEL.
import type { ToolDef } from '../llm/anthropic.service';

export const JUDGE_PROMPT = `You check an accounts-payable invoice against an expert's guardrails just before it is saved. For each guardrail decide whether saving this invoice as drafted would break it. Only mark a guardrail violated when the ErpContext clearly breaks it; if it does not apply to this invoice, it is not violated.`;

export const JUDGE_TOOL: ToolDef = {
  name: 'judge_guardrails',
  description: 'Return the guardrails this save would violate (empty if none).',
  input_schema: {
    type: 'object',
    required: ['violated'],
    properties: {
      violated: {
        type: 'array',
        items: { type: 'object', required: ['id', 'why'], properties: { id: { type: 'string' }, why: { type: 'string' } } },
      },
    },
  },
};

export interface JudgeResult { violated: { id: string; why: string }[] }
