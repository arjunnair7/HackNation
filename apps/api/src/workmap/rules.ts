import jsonLogic from 'json-logic-js';
import type { ErpContext } from '@apprentice/shared';

/** Every path a rule may read (BUILD_PLAN §5 ErpContext). */
export const ERP_CONTEXT_VARS = new Set([
  'invoice.id', 'invoice.amount', 'invoice.currency', 'invoice.category', 'invoice.month',
  'invoice.supplier.id', 'invoice.supplier.name', 'invoice.supplier.country', 'invoice.supplier.known',
  'invoice.supplier.isSubsidiary', 'invoice.poAssetNumber',
  'draft.costCenter', 'draft.assetNumber', 'draft.action', 'draft.routeTo', 'draft.comment',
]);

/**
 * Keeps a JSONLogic rule only if it reads ErpContext variables exclusively and evaluates without
 * throwing on the sample contexts. A dropped rule leaves its guardrail to the LLM judge (Phase 8).
 */
export function validRule(rule: unknown, samples: ErpContext[]): object | undefined {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule) || !jsonLogic.is_logic(rule)) return undefined;
  const vars = jsonLogic.uses_data(rule as Record<string, unknown>).map(String);
  if (vars.length === 0 || vars.some((v) => !ERP_CONTEXT_VARS.has(v))) return undefined;
  try {
    for (const ctx of samples) jsonLogic.apply(rule as jsonLogic.RulesLogic, ctx);
  } catch {
    return undefined;
  }
  return rule;
}
