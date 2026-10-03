// Shared types for api + web. Type-only module: always `import type { … } from '@apprentice/shared'`.

// ---------------------------------------------------------------------------
// Sessions, Work Map (BUILD_PLAN §4)
// ---------------------------------------------------------------------------

export type Mode = 'capture' | 'debrief' | 'teach';

export interface Session {
  id: string; mode: Mode; createdAt: string;
  expert: { name: string; role: string }; trainee?: { name: string };
  task: string;                         // "Process supplier invoices before period close"
  startedAtMs: number;                  // session clock origin; t = seconds since start
  frames: FrameRef[];
  events: ScreenEvent[];
  transcript: Utterance[];
  moments: Moment[];
  answers: Answer[];
  offRecord: { from: number; to?: number }[];
  mapId?: string;                       // capture: produced map; teach: map being taught
  mastery?: MasteryRecord[];            // teach only
}

export interface FrameRef { id: string; t: number; path: string; redacted: boolean }

export interface ScreenEvent {
  id: string; t: number; frameId: string;
  kind: 'opened' | 'navigated' | 'field_changed' | 'action' | 'lookup' | 'typed' | 'read' | 'other';
  entity?: string;                      // "INV-4471"
  field?: string; from?: string; to?: string;
  description: string;                  // "Cost center changed 4711 → 0400 on INV-4471"
}

export interface Utterance {
  id: string; t: number; speaker: 'expert' | 'agent' | 'trainee';
  text: string; final: boolean; offRecord?: boolean;
}

export interface Moment {                // a candidate "why" moment (Q2)
  id: string; t: number; eventIds: string[]; entity?: string;
  summary: string;                      // "Moved INV-4471 from 4711 to 0400"
  score: number;                        // 0..1
  suggestedType: 'WHY' | 'LIMIT' | 'STOP' | 'NEVER' | 'EXCEPTION';
  coveredByNarration: boolean;          // expert already explained → don't ask
  status: 'pending' | 'offered' | 'asked' | 'answered' | 'expired';
}

export interface Answer {
  id: string; momentOrQuestionId: string; t: number;
  quote: string;                        // verbatim expert words (from transcript)
  summary?: string; guardrailText?: string; guardrailKind?: GuardrailKind;
  source: 'live' | 'debrief' | 'narration';
}

export type GuardrailKind = 'limit' | 'exception' | 'stop_and_ask' | 'never' | 'rule';

export interface WorkMap {
  id: string; sessionId: string; version: number;
  task: string; expert: { name: string; role: string };
  steps: Step[]; guardrails: Guardrail[]; openQuestions: OpenQuestion[];
  teachback: { status: 'pending' | 'corrected' | 'confirmed'; corrections: string[]; confirmedAt?: string };
  coverage: { steps: number; stepsWithReason: number; guardrails: number; guardrailsWithSource: number };
  struck: string[];                     // ids the expert removed from the record
}

export interface Step {
  id: string; order: number; title: string;      // "Code the invoice to a cost center"
  screenMoment: { t: number; frameId: string; entity?: string; field?: string };
  decision: string;                               // "Re-coded from opex (4711) to capex (0400)"
  judgmentCall: boolean;
  reason?: { quote: string; t: number; source: 'live' | 'debrief' | 'narration' };
  guardrailIds: string[];
  appliesWhen?: object;                           // JSONLogic over ErpContext (§5) → step relevant
}

export interface Guardrail {
  id: string; kind: GuardrailKind; text: string;  // "No asset number, no capex booking"
  quote: string; t: number;                       // expert's words + when said
  screenMoment?: { t: number; frameId: string };
  violatedWhen?: object;                          // JSONLogic over ErpContext → true = violation
}

export interface OpenQuestion {
  id: string; question: string; why: string; relatedStepId?: string;
  status: 'open' | 'answered' | 'skipped'; answerQuote?: string;
}

export interface MasteryRecord {
  stepId?: string; guardrailId?: string; invoiceId: string;
  kind: 'prediction' | 'guardrail_caught' | 'fixed_after_hint' | 'clean';
  correct?: boolean; t: number;
}

// ---------------------------------------------------------------------------
// Sessions API + socket payloads (Phase 3)
// ---------------------------------------------------------------------------

/** POST /api/sessions */
export interface CreateSessionRequest {
  mode?: Mode;
  expert?: { name: string; role: string };
  trainee?: { name: string };
  task?: string;
  mapId?: string;
}

/** POST /api/sessions/:id/transcript. The server maps 'user' to expert or trainee by session mode. */
export interface TranscriptRequest { t: number; role: 'user' | 'agent'; text: string }

/** POST /api/sessions/:id/frames */
export interface FrameUploadRequest { t: number; jpegBase64: string }
export interface FrameUploadResponse { frameId: string }

/** POST /api/sessions/:id/events (debug drawer: inject a fake screen event). */
export type DebugEventRequest = Pick<ScreenEvent, 'kind' | 'description'> &
  Partial<Pick<ScreenEvent, 'entity' | 'field' | 'from' | 'to' | 't'>>;

/** socket `screen_events`: one analysed frame (events may be empty). */
export interface ScreenEventsMessage {
  sessionId: string; frameId: string; t: number;
  screen: string; entity?: string;
  events: ScreenEvent[];
  ms: number;                           // vision latency
}

/** socket `vision_error` */
export interface VisionErrorMessage { sessionId: string; frameId: string; t: number; error: string }

// ---------------------------------------------------------------------------
// ElevenLabs client tools (BUILD_PLAN §6). Names and params are case-sensitive:
// apps/api/scripts/setup-agents.ts registers exactly these, the web app handles them.
// ---------------------------------------------------------------------------

export interface InterviewerToolParams {
  record_answer: {
    moment_id: string; reason_quote: string; decision_summary?: string;
    guardrail_text?: string; guardrail_kind?: GuardrailKind;
  };
  go_off_record: Record<string, never>;
  submit_correction: { correction: string };
  confirm_teachback: Record<string, never>;
}

export interface TutorToolParams {
  record_prediction: { step_id: string; correct: boolean; trainee_answer?: string };
  replay_expert_moment: { step_id: string };
  show_mastery_report: Record<string, never>;
}

export type InterviewerToolName = keyof InterviewerToolParams;
export type TutorToolName = keyof TutorToolParams;

// ---------------------------------------------------------------------------
// Sandbox ERP (BUILD_PLAN §5)
// ---------------------------------------------------------------------------

export type InvoiceCategory = 'equipment' | 'consumables' | 'services';
export type ErpAction = 'approve' | 'hold' | 'route';
export type RouteTarget = 'controller' | 'intercompany';
export type ErpQueue = 'expert' | 'trainee';
export type InvoiceStatus = 'open' | 'posted' | 'on_hold' | 'routed';

/** The variables guardrail rules (JSONLogic `violatedWhen` / `appliesWhen`) can reference. */
export interface ErpContext {
  invoice: { id: string; amount: number; currency: 'EUR'; category: InvoiceCategory;
             month: number; supplier: { id: string; name: string; country: string;
             known: boolean; isSubsidiary: boolean }; poAssetNumber?: string };
  draft:   InvoiceDraft;
}

export interface InvoiceDraft {
  costCenter: string; assetNumber?: string; action?: ErpAction;
  routeTo?: RouteTarget; comment?: string;
}

export interface CostCenter {
  code: string;                         // "4711"
  name: string;                         // "Maintenance & Repairs"
  type: 'opex' | 'capex';
}

export interface Supplier {
  id: string;                           // vendor number; provisional for suppliers not in the vendor master
  name: string; country: string;
  known: boolean;                       // in vendor master
  isSubsidiary: boolean;                // group company
  city: string;
  vendorSince?: string;                 // ISO date the supplier entered the vendor master
}

export interface InvoiceLine {
  description: string;
  quantity: number; unit: string; unitPrice: number; amount: number;
  poNumber?: string; assetNumber?: string;
}

export interface Invoice {
  id: string;                           // "INV-4471"
  queue: ErpQueue;
  supplierId: string;
  invoiceDate: string; dueDate: string; // ISO dates
  month: number;                        // posting month, 1..12
  category: InvoiceCategory;
  amount: number; currency: 'EUR';
  poNumber?: string; poAssetNumber?: string;
  defaultCostCenter: string;            // what the ERP proposes
  lines: InvoiceLine[];
}

export interface SupplierHistoryEntry {
  date: string;                         // ISO date
  documentId: string;                   // "INV-3921" / "CN-0112"
  type: 'invoice' | 'credit_note';
  description: string;
  amount: number;                       // negative for credit notes
  costCenter?: string;
  status: 'paid' | 'credited' | 'applied'; // credited = reversed by a credit note; applied = credit note used
}

/** Row in the queue list. */
export interface ErpInvoiceSummary {
  id: string; queue: ErpQueue;
  supplier: { id: string; name: string; known: boolean };
  description: string;                  // first line item
  amount: number; currency: 'EUR';
  dueDate: string;
  costCenter: string;                   // current draft cost center
  status: InvoiceStatus; routeTo?: RouteTarget;
}

/** GET /api/erp/invoices/:id */
export interface ErpInvoiceDetail {
  invoice: Invoice;
  supplier: Supplier;
  draft: InvoiceDraft;
  status: InvoiceStatus;
  processedAt?: string;
  history: SupplierHistoryEntry[];      // newest first
  costCenters: CostCenter[];
}

/** PATCH /api/erp/invoices/:id/draft. An empty string clears assetNumber / comment. */
export type DraftPatch = Partial<Pick<InvoiceDraft, 'costCenter' | 'assetNumber' | 'comment' | 'routeTo'>>;

/** POST /api/erp/invoices/:id/action */
export interface ErpActionRequest {
  action: ErpAction;
  routeTo?: RouteTarget;                // required for 'route'
  comment?: string;                     // 'hold' needs a comment (here or already in the draft)
}

/** 409 body from the save gate (Phase 8) when a guardrail would be violated. */
export interface ErpGuardrailBlock {
  error: 'guardrail_blocked';
  guardrail: { id: string; kind: GuardrailKind; text: string };
}
