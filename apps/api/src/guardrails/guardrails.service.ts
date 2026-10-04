import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import jsonLogic from 'json-logic-js';
import type {
  ErpContext,
  Guardrail,
  GuardrailAlertMessage,
  GuardrailKind,
  GuardrailResolvedMessage,
  MasteryRecord,
  MasteryUpdatedMessage,
  RecordPredictionRequest,
  Session,
  Step,
  TeachCueMessage,
  TeachInvoiceMessage,
  WorkMap,
} from '@apprentice/shared';
import { ErpService } from '../erp/erp.service';
import { AnthropicService } from '../llm/anthropic.service';
import { JUDGE_PROMPT, JUDGE_TOOL, type JudgeResult } from '../prompts/judge';
import { EventsGateway } from '../realtime/events.gateway';
import { SessionStore } from '../sessions/session.store';
import { TeachState } from '../sessions/teach.state';
import { WorkMapService } from '../workmap/workmap.service';

const OPEN_DEDUPE_MS = 15_000; // an ERP reload is not a new "open"
const RISK_DEBOUNCE_MS = 1000; // let a multi-field edit finish before judging the draft
const BOUNDARY_SHARE = 0.1; // within 10 % of a € threshold counts as a boundary case
const KIND_PRIORITY: GuardrailKind[] = ['never', 'stop_and_ask', 'limit', 'exception', 'rule'];

const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

interface Active { session: Session; map: WorkMap; expert: string; trainee: string }

/**
 * Q4 "did the new hire learn": everything the tutor needs from the server.
 *  - invoice opened → one [PREDICT] (applicable judgment call) or [STEP_START] cue
 *  - draft changed  → evaluate every violatedWhen with "approve" simulated → guardrail_risk
 *  - action posted  → the save gate (rules, then an LLM judge for rule-less guardrails) → 409
 *  - mastery: predictions, guardrails caught, fixed after the hint, clean invoices
 */
@Injectable()
export class GuardrailService {
  private readonly logger = new Logger(GuardrailService.name);
  private key?: string; // teach session the per-invoice state belongs to
  private opened = new Map<string, number>();
  private flagged = new Map<string, Set<string>>(); // invoice → guardrails caught on it
  private predicted = new Map<string, string>(); // invoice → step the trainee predicted
  private lastInvoice?: string;
  private invoicesOpened = 0;
  private readonly riskTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly judgeCache = new Map<string, { at: number; ids: string[] }>();

  constructor(
    private readonly teach: TeachState,
    private readonly store: SessionStore,
    private readonly maps: WorkMapService,
    private readonly erp: ErpService,
    private readonly llm: AnthropicService,
    private readonly gateway: EventsGateway,
  ) {}

  // --- ERP hooks ------------------------------------------------------------------

  /** ERP GET /invoices/:id. */
  onInvoiceOpened(invoiceId: string): void {
    const a = this.active();
    if (!a) return;
    const detail = this.erp.getDetail(invoiceId);
    if (detail.status !== 'open') return;
    const now = Date.now();
    if (now - (this.opened.get(detail.invoice.id) ?? 0) < OPEN_DEDUPE_MS) return;
    this.opened.set(detail.invoice.id, now);
    this.lastInvoice = detail.invoice.id;
    this.invoicesOpened += 1;

    const ctx = this.erp.getContext(detail.invoice.id);
    const label = invoiceLabel(ctx);
    const opened: TeachInvoiceMessage = { sessionId: a.session.id, invoiceId: ctx.invoice.id, label };
    this.gateway.emit('teach_invoice_opened', opened);

    const pick = this.pickStep(a.map, ctx);
    if (!pick) return;
    const { step, type, boundary } = pick;
    const text =
      type === 'PREDICT'
        ? `[PREDICT ${step.id}] ${label} is open. Before ${a.trainee} codes it, ask her out loud, now, to predict what ${a.expert} would do here and why.` +
          `${boundary ? ` It is a boundary case: ${eur.format(ctx.invoice.amount)} against the ${eur.format(boundary)} line.` : ''}` +
          ` Wait for her answer, compare it with the Work Map, call record_prediction with step_id ${step.id}, and give one sentence of feedback with ${a.expert}'s reason. Do not call skip_turn.`
        : `[STEP_START ${step.id}] ${label} is open. In one or two sentences, tell ${a.trainee} how ${a.expert} handles "${step.title}", quoting her reason if there is one. Do not call skip_turn.`;
    const cue: TeachCueMessage = { sessionId: a.session.id, invoiceId: ctx.invoice.id, type, stepId: step.id, text, ...(boundary && { boundary: true }) };
    this.gateway.emit('teach_cue', cue);
    this.logger.log(`${a.session.id}: ${ctx.invoice.id} opened → ${type} ${step.id}${boundary ? ' (boundary)' : ''}`);
  }

  /** ERP PATCH /draft: judge the draft as if it were approved now, once the edit settles. */
  onDraftChanged(invoiceId: string): void {
    if (!this.active()) return;
    clearTimeout(this.riskTimers.get(invoiceId));
    this.riskTimers.set(invoiceId, setTimeout(() => this.checkRisk(invoiceId), RISK_DEBOUNCE_MS));
  }

  /**
   * POST /action: the save gate. Returns the guardrail that blocks this save (and records the catch),
   * or undefined when the save may go ahead. No active teach session → no gate.
   */
  async gate(invoiceId: string, body: unknown): Promise<Guardrail | undefined> {
    const a = this.active();
    if (!a) return undefined;
    const ctx = this.erp.previewAction(invoiceId, body); // also validates the request
    const violated = [...this.ruleViolations(a.map, ctx), ...(await this.judgeViolations(a.map, ctx))];
    const top = mostImportant(violated);
    if (!top) return undefined;
    clearTimeout(this.riskTimers.get(ctx.invoice.id)); // the block supersedes a pending risk cue
    const warned = this.flagged.get(ctx.invoice.id)?.has(top.id) ?? false;
    this.caught(a, ctx.invoice.id, top);
    const alert = this.alert(a, ctx, top, 'GUARDRAIL_BLOCKED', warned);
    this.gateway.emit('guardrail_blocked', alert);
    this.logger.log(`${a.session.id}: save of ${ctx.invoice.id} blocked by ${top.id}`);
    return top;
  }

  /** After a successful save: fixes count as "fixed after the hint", untouched invoices as "clean". */
  afterSave(invoiceId: string): void {
    const a = this.active();
    if (!a) return;
    const flagged = this.flagged.get(invoiceId);
    if (flagged?.size) {
      for (const g of flagged) this.record(a, { guardrailId: g, stepId: stepFor(a.map, g)?.id, invoiceId, kind: 'fixed_after_hint' });
      flagged.clear();
    } else {
      this.record(a, { invoiceId, stepId: this.predicted.get(invoiceId), kind: 'clean' });
    }
  }

  // --- tutor tool ----------------------------------------------------------------------

  /** record_prediction. */
  recordPrediction(sessionId: string, body: unknown): MasteryRecord[] {
    const b = (body ?? {}) as Partial<RecordPredictionRequest>;
    if (typeof b.stepId !== 'string' || typeof b.correct !== 'boolean') throw new BadRequestException('Expected { stepId, correct }');
    const a = this.active();
    if (!a || a.session.id !== sessionId) throw new BadRequestException(`${sessionId} is not the active teach session`);
    const invoiceId = b.invoiceId || this.lastInvoice || '';
    if (invoiceId) this.predicted.set(invoiceId, b.stepId);
    return this.record(a, { stepId: b.stepId, invoiceId, kind: 'prediction', correct: b.correct });
  }

  // --- deciding what to teach ------------------------------------------------------------

  /**
   * The first judgment call that matters for this invoice gets a [PREDICT]. It matters when its
   * appliesWhen holds, when one of its guardrails would be broken by approving the ERP's proposal,
   * or when the amount sits within 10 % of one of its € thresholds (the €4,950 vs €5,000 case).
   * Otherwise only the trainee's first invoice gets an orienting [STEP_START].
   */
  private pickStep(map: WorkMap, ctx: ErpContext): { step: Step; type: TeachCueMessage['type']; boundary?: number } | undefined {
    const live = map.steps.filter((s) => !map.struck.includes(s.id));
    const approve = withAction(ctx, 'approve');
    for (const step of live.filter((s) => s.judgmentCall)) {
      const guardrails = step.guardrailIds.map((id) => map.guardrails.find((g) => g.id === id)).filter((g): g is Guardrail => !!g && !map.struck.includes(g.id));
      const applies = truthy(step.appliesWhen, ctx) || guardrails.some((g) => truthy(g.violatedWhen, approve));
      const boundary = nearThreshold([step.appliesWhen, ...guardrails.map((g) => g.violatedWhen)], ctx.invoice.amount);
      if (applies || boundary) return { step, type: 'PREDICT', ...(boundary && !applies && { boundary }) };
    }
    return this.invoicesOpened === 1 && live[0] ? { step: live[0], type: 'STEP_START' } : undefined;
  }

  // --- risk ---------------------------------------------------------------------------------

  private checkRisk(invoiceId: string): void {
    this.riskTimers.delete(invoiceId);
    const a = this.active();
    if (!a) return;
    let ctx: ErpContext;
    try {
      if (this.erp.getDetail(invoiceId).status !== 'open') return;
      ctx = withAction(this.erp.getContext(invoiceId), 'approve');
    } catch {
      return;
    }
    const violated = this.ruleViolations(a.map, ctx);
    const flagged = this.flagged.get(invoiceId) ?? new Set<string>();
    for (const g of flagged) {
      if (violated.some((v) => v.id === g)) continue;
      const resolved: GuardrailResolvedMessage = { sessionId: a.session.id, invoiceId, guardrailId: g };
      this.gateway.emit('guardrail_resolved', resolved);
    }
    const top = mostImportant(violated.filter((g) => !flagged.has(g.id)));
    if (!top) return;
    this.caught(a, invoiceId, top);
    const alert = this.alert(a, ctx, top, 'GUARDRAIL_RISK');
    this.gateway.emit('guardrail_risk', alert);
    this.logger.log(`${a.session.id}: ${invoiceId} draft would break ${top.id} (${top.text})`);
  }

  private alert(a: Active, ctx: ErpContext, g: Guardrail, cue: 'GUARDRAIL_RISK' | 'GUARDRAIL_BLOCKED', warned = false): GuardrailAlertMessage {
    const step = stepFor(a.map, g.id);
    const cc = this.erp.getDetail(ctx.invoice.id).costCenters.find((c) => c.code === ctx.draft.costCenter);
    const draft = `cost center ${ctx.draft.costCenter}${cc ? ` (${cc.name})` : ''}${ctx.draft.assetNumber ? `, asset ${ctx.draft.assetNumber}` : ', no asset number'}`;
    const did =
      cue === 'GUARDRAIL_RISK'
        ? `${a.trainee} has ${draft} on ${invoiceLabel(ctx)}`
        : `${a.trainee} tried to ${ctx.draft.action === 'route' ? `route ${invoiceLabel(ctx)} to ${ctx.draft.routeTo}` : `${ctx.draft.action} ${invoiceLabel(ctx)}`} with ${draft}; the save was blocked`;
    // Already warned about this guardrail on this invoice: don't repeat the question, just remind.
    const reminder =
      `[${cue} ${g.id} "${g.text}"] ${did}, although you already flagged this guardrail. In one or two calm sentences, ` +
      `remind her what ${a.expert} does here and what to change before saving. Never fix it for her. Do not call skip_turn.`;
    // Two turns, spelled out: in testing the tutor otherwise skipped the question and explained at once.
    const text = warned ? reminder :
      `[${cue} ${g.id} "${g.text}"] ${did}. This turn, say only this, word for word: "${a.expert} would stop here. Why do you think?" ` +
      `Then stop talking and wait for her answer. Do not explain yet. After she answers, in your next turn: explain with ` +
      `${a.expert}'s exact words${g.quote ? ` ("${g.quote}")` : ''}, call replay_expert_moment with step_id ${step?.id ?? g.id}, ` +
      `and tell her what to change. Never fix it for her. Do not call skip_turn.`;
    return {
      sessionId: a.session.id,
      invoiceId: ctx.invoice.id,
      guardrail: { id: g.id, kind: g.kind, text: g.text, quote: g.quote },
      ...(step && { stepId: step.id }),
      text,
    };
  }

  // --- evaluation --------------------------------------------------------------------------

  private ruleViolations(map: WorkMap, ctx: ErpContext): Guardrail[] {
    return map.guardrails.filter((g) => !map.struck.includes(g.id) && g.violatedWhen && truthy(g.violatedWhen, ctx));
  }

  /** Guardrails without a usable rule: one batched MAP_MODEL call, cached briefly per context. */
  private async judgeViolations(map: WorkMap, ctx: ErpContext): Promise<Guardrail[]> {
    const ruleless = map.guardrails.filter((g) => !map.struck.includes(g.id) && !g.violatedWhen);
    if (!ruleless.length) return [];
    const key = JSON.stringify([map.id, ctx]);
    const cached = this.judgeCache.get(key);
    let ids = cached && Date.now() - cached.at < 60_000 ? cached.ids : undefined;
    if (!ids) {
      try {
        const result = await this.llm.callTool<JudgeResult>({
          model: process.env.MAP_MODEL || 'claude-sonnet-5-5',
          system: JUDGE_PROMPT,
          tool: JUDGE_TOOL,
          effort: 'low',
          maxTokens: 2048,
          content:
            `Guardrails:\n${ruleless.map((g) => `- ${g.id} (${g.kind}): ${g.text}${g.quote ? ` — expert: "${g.quote}"` : ''}`).join('\n')}` +
            `\n\nErpContext about to be saved:\n${JSON.stringify(ctx)}`,
        });
        ids = (result.violated ?? []).map((v) => v.id);
      } catch (err) {
        this.logger.warn(`guardrail judge failed, letting the save through: ${(err as Error).message}`);
        ids = [];
      }
      this.judgeCache.set(key, { at: Date.now(), ids });
    }
    return ruleless.filter((g) => ids!.includes(g.id));
  }

  // --- mastery -------------------------------------------------------------------------------

  private caught(a: Active, invoiceId: string, g: Guardrail): void {
    const flagged = this.flagged.get(invoiceId) ?? new Set<string>();
    if (flagged.has(g.id)) return;
    flagged.add(g.id);
    this.flagged.set(invoiceId, flagged);
    this.record(a, { guardrailId: g.id, stepId: stepFor(a.map, g.id)?.id, invoiceId, kind: 'guardrail_caught' });
  }

  private record(a: Active, rec: Omit<MasteryRecord, 't'>): MasteryRecord[] {
    const session = this.store.update(a.session.id, (s) => {
      s.mastery = [...(s.mastery ?? []), { ...rec, t: (Date.now() - s.startedAtMs) / 1000 }];
    });
    const message: MasteryUpdatedMessage = { sessionId: session.id, mastery: session.mastery ?? [] };
    this.gateway.emit('mastery_updated', message);
    return message.mastery;
  }

  private active(): Active | undefined {
    const id = this.teach.activeSessionId;
    const session = id ? this.store.get(id) : undefined;
    if (!session?.mapId) return undefined;
    if (this.key !== session.id) {
      // a new teach session starts with a clean slate
      this.key = session.id;
      this.opened = new Map();
      this.flagged = new Map();
      this.predicted = new Map();
      this.lastInvoice = undefined;
      this.invoicesOpened = 0;
    }
    try {
      const map = this.maps.getById(session.mapId);
      return { session, map, expert: map.expert.name, trainee: session.trainee?.name ?? 'the trainee' };
    } catch {
      return undefined;
    }
  }
}

// --- helpers --------------------------------------------------------------------------------

function truthy(rule: object | undefined, ctx: ErpContext): boolean {
  if (!rule) return false;
  try {
    return jsonLogic.truthy(jsonLogic.apply(rule as jsonLogic.RulesLogic, ctx));
  } catch {
    return false;
  }
}

const withAction = (ctx: ErpContext, action: 'approve'): ErpContext => ({ ...ctx, draft: { ...ctx.draft, action } });

function mostImportant(guardrails: Guardrail[]): Guardrail | undefined {
  return [...guardrails].sort((a, b) => KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind))[0];
}

function stepFor(map: WorkMap, guardrailId: string): Step | undefined {
  return map.steps.find((s) => s.guardrailIds.includes(guardrailId) && !map.struck.includes(s.id));
}

function invoiceLabel(ctx: ErpContext): string {
  return `${ctx.invoice.id} (${ctx.invoice.supplier.name}, ${eur.format(ctx.invoice.amount)}, ${ctx.invoice.category})`;
}

/** A € threshold on invoice.amount in any of the rules that this amount sits within 10 % of. */
function nearThreshold(rules: (object | undefined)[], amount: number): number | undefined {
  const thresholds: number[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    for (const [op, args] of Object.entries(node)) {
      if (['>', '>=', '<', '<='].includes(op) && Array.isArray(args)) {
        const amountSide = args.findIndex((x) => x && typeof x === 'object' && (x as { var?: unknown }).var === 'invoice.amount');
        const value = args.find((x) => typeof x === 'number');
        if (amountSide >= 0 && typeof value === 'number' && value > 0) thresholds.push(value);
      }
      walk(args);
    }
  };
  rules.forEach(walk);
  return thresholds.find((t) => Math.abs(amount - t) <= t * BOUNDARY_SHARE);
}
