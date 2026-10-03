// BUILD_PLAN §7.3: VISION_MODEL, forced tool report_screen.
import type { ToolDef } from '../llm/anthropic.service';

export const VISION_PROMPT = `You watch an accounts-payable expert's screen, one frame at a time. You receive the current frame and the previous screen state (JSON). Report the current screen state and what CHANGED since the previous state as events.

Rules:
- Only report what is visible. Do not guess intentions.
- Events: opened (a record was opened), navigated (switched page/tab), field_changed (value differs from previous state — give field, from, to), action (a button outcome is visible: approved, held, routed, status change), lookup (the user opened reference info like supplier history), typed (free text entered), read (no change; user is reading a record), other.
- "description" is one short sentence a colleague would understand, e.g. "Cost center on INV-4471 changed 4711 → 0400 (Maintenance → Capital Equipment)".
- If nothing meaningful changed, return an empty events array.
- PRIVACY: never output names of private persons, IBANs or bank account numbers, emails, phone numbers or street addresses. Replace them with [NAME], [IBAN], [EMAIL], [PHONE], [ADDRESS]. Company names, invoice ids, amounts and cost centers are fine. Also return pii_regions: normalized boxes of any such data visible in the frame.`;

export const REPORT_SCREEN_TOOL: ToolDef = {
  name: 'report_screen',
  description: 'Report the current screen state and the events that changed since the previous state.',
  input_schema: {
    type: 'object',
    required: ['screen', 'state', 'events'],
    properties: {
      screen: { type: 'string', description: 'invoice_list | invoice_detail | supplier_history | other' },
      entity: { type: 'string', description: 'main record id visible, e.g. INV-4471' },
      state: { type: 'object', description: 'visible key fields: supplier, amount, cost_center, asset_number, status, active_tab…' },
      events: {
        type: 'array',
        items: {
          type: 'object',
          required: ['kind', 'description'],
          properties: {
            kind: { type: 'string', enum: ['opened', 'navigated', 'field_changed', 'action', 'lookup', 'typed', 'read', 'other'] },
            entity: { type: 'string' },
            field: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
            description: { type: 'string' },
          },
        },
      },
      pii_regions: {
        type: 'array',
        items: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
        },
      },
    },
  },
};

/** What report_screen returns. */
export interface ReportScreenResult {
  screen: string;
  entity?: string;
  state: Record<string, unknown>;
  events: { kind: string; entity?: string; field?: string; from?: string; to?: string; description: string }[];
  pii_regions?: { x: number; y: number; w: number; h: number }[];
}
