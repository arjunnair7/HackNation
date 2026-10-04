import type { GuardrailKind, WorkMap } from '@apprentice/shared';

const KIND: Record<GuardrailKind, string> = {
  limit: 'LIMIT', exception: 'EXCEPTION', stop_and_ask: 'STOP AND ASK', never: 'NEVER', rule: 'RULE',
};
const MAX_CHARS = 3000;

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

function render(map: WorkMap, withIds: boolean, quoteChars: number): string {
  const struck = new Set(map.struck);
  const steps = map.steps.filter((s) => !struck.has(s.id));
  const guardrails = map.guardrails.filter((g) => !struck.has(g.id));
  const quote = (q?: string) => (q && quoteChars > 0 ? ` — "${clip(q, quoteChars)}"` : '');
  const lines = [`Task: ${map.task} (${map.expert.name}, ${map.expert.role})`, '', 'Steps:'];
  steps.forEach((s, i) => {
    const id = withIds ? `[${s.id}] ` : '';
    const links = withIds && s.guardrailIds.length ? ` (guardrails: ${s.guardrailIds.filter((g) => !struck.has(g)).join(', ')})` : '';
    lines.push(`${i + 1}. ${id}${s.title}: ${s.decision}${s.judgmentCall ? ' [judgment call]' : ''}${quote(s.reason?.quote)}${links}`);
  });
  lines.push('', 'Guardrails:');
  for (const g of guardrails) lines.push(`- ${withIds ? `[${g.id}] ` : ''}${KIND[g.kind]}: ${g.text}${quote(g.quote)}`);
  return lines.join('\n');
}

/** Steps, guardrails and the expert's quotes as plain text for the agent (under ~3k characters). */
export function renderCompact(map: WorkMap): string {
  for (const quoteChars of [160, 90, 0]) {
    const text = render(map, false, quoteChars);
    if (text.length <= MAX_CHARS) return text;
  }
  return clip(render(map, false, 0), MAX_CHARS);
}

/** Same, plus step and guardrail ids, minus struck items: the tutor's {{work_map}} (Phase 8). */
export function renderForTutor(map: WorkMap): string {
  return render(map, true, 200);
}
