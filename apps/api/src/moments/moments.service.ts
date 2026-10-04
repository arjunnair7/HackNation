import { BadRequestException, ConflictException, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type {
  Answer,
  AnswerRecordedMessage,
  GuardrailKind,
  Moment,
  MomentStatusRequest,
  MomentsUpdatedMessage,
  RecordAnswerRequest,
  ScreenEvent,
  Session,
  Utterance,
} from '@apprentice/shared';
import { newId } from '../common/ids';
import { ErpService } from '../erp/erp.service';
import { AnthropicService } from '../llm/anthropic.service';
import { isOffRecordNow } from '../privacy/record';
import { redactText } from '../privacy/redact';
import { NARRATION_PROMPT, REPORT_NARRATION_TOOL, type ReportNarrationResult } from '../prompts/narration';
import { EventsGateway } from '../realtime/events.gateway';
import { SessionStore } from '../sessions/session.store';

const GROUP_WINDOW_S = 10; // events on the same invoice this close together form one moment
const LOOKUP_WINDOW_S = 120; // a lookup this long before a hold/route counts towards it
const EXPIRE_AFTER_S = 120; // unasked moments fall through to the debrief
const ASK_THRESHOLD = 0.6; // the web detector only offers moments at or above this
const NARRATION_BEFORE_S = 15;
const NARRATION_AFTER_S = 5;
const TRANSCRIPT_LAG_S = 2; // a final transcript line lands a little after the words are spoken
const ANSWER_SETTLE_MS = 1500; // record_answer can race the expert's last transcript line
const GUARDRAIL_KINDS: readonly GuardrailKind[] = ['limit', 'exception', 'stop_and_ask', 'never', 'rule'];

type Signal = 'deviation' | 'action' | 'lookup' | 'approve' | 'other';
interface Scored { score: number; type: Moment['suggestedType']; signal: Signal }

const OTHER: Scored = { score: 0.05, type: 'WHY', signal: 'other' };

/**
 * Q2 "what to ask": screen events → moments, scored per BUILD_PLAN Phase 4.
 *   field changed away from the ERP default (cost center, asset number) → 0.85 LIMIT
 *   hold / route (any action other than approve)                       → 0.85 STOP
 *   supplier-history lookup followed by hold / route                    → folded into that moment
 *   lookup on its own → 0.3, approve → 0.1, opened / navigated / read  → 0.05
 * Events are grouped per invoice (not per field) so one decision becomes one question.
 */
@Injectable()
export class MomentsService implements OnModuleDestroy {
  private readonly logger = new Logger(MomentsService.name);
  private readonly active = new Map<string, number>(); // sessionId → last activity, for the expiry sweep
  private readonly narrationScheduled = new Set<string>();
  private readonly sweep = setInterval(() => this.expireStale(), 5000);

  constructor(
    private readonly store: SessionStore,
    private readonly gateway: EventsGateway,
    private readonly llm: AnthropicService,
    private readonly erp: ErpService,
  ) {}

  onModuleDestroy() {
    clearInterval(this.sweep);
  }

  onEvents(sessionId: string, events: ScreenEvent[]): void {
    this.active.set(sessionId, Date.now());
    const ready: string[] = [];
    const session = this.store.update(sessionId, (s) => {
      const touched = new Set<Moment>();
      for (const event of events) {
        const entity = entityOf(event);
        if (!entity) continue; // e.g. "queue loaded": nothing to ask about
        let moment = [...s.moments]
          .reverse()
          .find((m) => m.entity === entity && m.status === 'pending' && event.t - m.t <= GROUP_WINDOW_S);
        if (!moment) {
          moment = {
            id: newId('m'), t: event.t, eventIds: [], entity, summary: '', score: 0,
            suggestedType: 'WHY', coveredByNarration: false, status: 'pending',
          };
          s.moments.push(moment);
        }
        moment.eventIds.push(event.id);
        moment.t = Math.max(moment.t, event.t);
        touched.add(moment);
      }
      for (const moment of touched) {
        if (!s.moments.includes(moment)) continue; // folded into another moment above
        this.rescore(s, moment);
        if (moment.score >= ASK_THRESHOLD && !moment.narrationChecked) ready.push(moment.id);
      }
    });
    for (const id of ready) this.scheduleNarrationCheck(sessionId, id);
    this.emit(session);
  }

  setStatus(sessionId: string, body: unknown): Moment[] {
    const req = body as Partial<MomentStatusRequest> | null;
    if (!req || !Array.isArray(req.ids) || !['offered', 'pending', 'expired'].includes(req.status as string)) {
      throw new BadRequestException('Expected { ids: string[], status: offered | pending | expired }');
    }
    this.active.set(sessionId, Date.now());
    const session = this.store.update(sessionId, (s) => {
      for (const m of s.moments) if (req.ids!.includes(m.id) && m.status !== 'answered') m.status = req.status!;
    });
    this.emit(session);
    return session.moments;
  }

  /** record_answer: the quote comes from the transcript (the tool's reason_quote is only the fallback). */
  async recordAnswer(sessionId: string, body: unknown): Promise<Answer> {
    const req = body as Partial<RecordAnswerRequest> | null;
    if (!req || typeof req.momentId !== 'string' || typeof req.reasonQuote !== 'string') {
      throw new BadRequestException('Expected { momentId, reasonQuote, ... }');
    }
    if (isOffRecordNow(this.store.require(sessionId))) throw new ConflictException('Off the record: nothing is recorded');
    await new Promise((r) => setTimeout(r, ANSWER_SETTLE_MS));

    let answer!: Answer;
    const session = this.store.update(sessionId, (s) => {
      const asked = req.momentId!.replace(/^id=/, '').trim();
      const offered = s.moments.filter((m) => m.status === 'offered');
      // The agent occasionally mangles an id; then the answer belongs to the best offered candidate.
      const target = s.moments.find((m) => m.id === asked) ?? offered[0];
      const struck = new Set(s.struck ?? []);
      const verbatim = answerAfterLastQuestion(s.transcript.filter((u) => !struck.has(u.id)));
      answer = {
        id: newId('a'),
        momentOrQuestionId: target?.id ?? asked,
        t: (Date.now() - s.startedAtMs) / 1000,
        quote: redactText(verbatim ?? req.reasonQuote!.trim()),
        summary: text(req.decisionSummary) && redactText(text(req.decisionSummary)!),
        guardrailText: text(req.guardrailText) && redactText(text(req.guardrailText)!),
        guardrailKind: GUARDRAIL_KINDS.includes(req.guardrailKind as GuardrailKind) ? req.guardrailKind : undefined,
        source: 'live',
      };
      s.answers.push(answer);
      for (const m of s.moments) {
        if (m === target) m.status = 'answered';
        else if (m.status === 'offered') m.status = 'pending'; // not picked this time; may be offered again
      }
      if (!verbatim) this.logger.warn(`${sessionId}: no expert answer in transcript, using the tool's reason_quote`);
    });
    this.emit(session);
    const message: AnswerRecordedMessage = { sessionId, answer };
    this.gateway.emit('answer_recorded', message);
    return answer;
  }

  // --- scoring -----------------------------------------------------------------

  private rescore(s: Session, moment: Moment): void {
    const byId = new Map(s.events.map((e) => [e.id, e]));
    const events = () =>
      moment.eventIds.map((id) => byId.get(id)).filter((e): e is ScreenEvent => !!e).sort((a, b) => a.t - b.t);
    const defaultCostCenter = this.defaultCostCenter(moment.entity);
    const classify = (e: ScreenEvent) => classifyEvent(e, defaultCostCenter);

    // "lookup followed by a non-approve action": pull a recent lookup-only moment into this one.
    if (events().some((e) => classify(e).signal === 'action')) {
      for (const other of s.moments.filter((m) => m !== moment && m.entity === moment.entity && m.status === 'pending')) {
        const otherEvents = other.eventIds.map((id) => byId.get(id)).filter((e): e is ScreenEvent => !!e);
        const lookupOnly = otherEvents.some((e) => classify(e).signal === 'lookup') && other.score < ASK_THRESHOLD;
        if (lookupOnly && moment.t - other.t <= LOOKUP_WINDOW_S) {
          moment.eventIds.unshift(...other.eventIds);
          s.moments.splice(s.moments.indexOf(other), 1);
        }
      }
    }

    const scored = events().map((e) => ({ e, ...classify(e) }));
    const best = scored.reduce<Scored>((a, b) => (b.score > a.score ? b : a), OTHER);
    moment.score = best.score;
    moment.suggestedType = best.type;
    const telling = scored.filter((x) => x.signal === 'deviation' || x.signal === 'action' || x.signal === 'lookup');
    const parts = (telling.length ? telling : scored.slice(-1)).map((x) => x.e.description.replace(/\.$/, ''));
    moment.summary = truncate(parts.join('; then '), 220);
  }

  private defaultCostCenter(entity?: string): string | undefined {
    if (!entity) return undefined;
    try {
      return this.erp.getDetail(entity).invoice.defaultCostCenter;
    } catch {
      return undefined; // not an ERP invoice
    }
  }

  // --- §7.5 already narrated? ---------------------------------------------------

  private scheduleNarrationCheck(sessionId: string, momentId: string): void {
    if (this.narrationScheduled.has(momentId)) return;
    this.narrationScheduled.add(momentId);
    const s = this.store.require(sessionId);
    const moment = s.moments.find((m) => m.id === momentId);
    if (!moment) return;
    const nowT = (Date.now() - s.startedAtMs) / 1000;
    const waitS = moment.t + NARRATION_AFTER_S + TRANSCRIPT_LAG_S - nowT;
    const delayMs = Math.min(Math.max(0, waitS), NARRATION_AFTER_S + TRANSCRIPT_LAG_S) * 1000;
    setTimeout(() => void this.checkNarration(sessionId, momentId), delayMs);
  }

  private async checkNarration(sessionId: string, momentId: string): Promise<void> {
    const s = this.store.get(sessionId);
    const moment = s?.moments.find((m) => m.id === momentId);
    if (!s || !moment) return;
    const struck = new Set(s.struck ?? []);
    const speech = s.transcript.filter(
      (u) =>
        u.speaker === 'expert' && !u.offRecord && !struck.has(u.id) &&
        u.t >= moment.t - NARRATION_BEFORE_S && u.t <= moment.t + NARRATION_AFTER_S + TRANSCRIPT_LAG_S,
    );

    let covered = false;
    let quote: string | undefined;
    if (speech.length) {
      try {
        const result = await this.llm.callTool<ReportNarrationResult>({
          model: process.env.VISION_MODEL || 'claude-haiku-4-5-20251001',
          system: NARRATION_PROMPT,
          tool: REPORT_NARRATION_TOOL,
          maxTokens: 512,
          content:
            `Screen event (t=${moment.t.toFixed(1)}s): ${moment.summary}\n\n` +
            `Expert speech:\n${speech.map((u) => `[t=${u.t.toFixed(1)}s] ${u.text}`).join('\n')}`,
        });
        covered = result.covered === true;
        const spoken = speech.map((u) => u.text).join(' ');
        // Only keep a quote the expert actually said; otherwise quote the whole window.
        quote = result.quote && spoken.toLowerCase().includes(result.quote.trim().toLowerCase()) ? result.quote.trim() : spoken;
      } catch (err) {
        this.logger.warn(`${sessionId} ${momentId}: narration check failed, treating as not covered: ${(err as Error).message}`);
      }
    }

    const session = this.store.update(sessionId, (s2) => {
      const m = s2.moments.find((x) => x.id === momentId);
      if (!m) return;
      m.narrationChecked = true;
      if (covered && quote) {
        m.coveredByNarration = true;
        s2.answers.push({
          id: newId('a'), momentOrQuestionId: m.id, t: speech[speech.length - 1].t, quote, source: 'narration',
        });
      }
    });
    this.logger.log(`${sessionId} ${momentId}: narration check ${covered ? 'covered' : 'not covered'} (${speech.length} line(s))`);
    this.emit(session);
  }

  // --- expiry -----------------------------------------------------------------------

  private expireStale(): void {
    for (const [sessionId, lastActive] of this.active) {
      if (Date.now() - lastActive > 30 * 60_000) {
        this.active.delete(sessionId);
        continue;
      }
      const s = this.store.get(sessionId);
      if (!s) continue;
      const nowT = (Date.now() - s.startedAtMs) / 1000;
      const isStale = (m: Moment) => (m.status === 'pending' || m.status === 'offered') && nowT - m.t > EXPIRE_AFTER_S;
      if (!s.moments.some(isStale)) continue;
      this.emit(this.store.update(sessionId, (s2) => s2.moments.filter(isStale).forEach((m) => (m.status = 'expired'))));
    }
  }

  private emit(session: Session): void {
    const message: MomentsUpdatedMessage = { sessionId: session.id, moments: session.moments };
    this.gateway.emit('moments_updated', message);
  }
}

// --- helpers --------------------------------------------------------------------------

function entityOf(e: ScreenEvent): string | undefined {
  const match = `${e.entity ?? ''} ${e.description}`.match(/INV-\d+/i);
  return match?.[0].toUpperCase();
}

function costCenterCode(e: ScreenEvent): string | undefined {
  const codes = (e.to ?? e.description).match(/\b\d{4}\b/g);
  return codes?.[e.to ? 0 : codes.length - 1];
}

export function classifyEvent(e: ScreenEvent, defaultCostCenter?: string): Scored {
  const field = e.field ?? '';
  const statusChange = e.kind === 'field_changed' && /status/i.test(field);
  if (e.kind === 'action' || statusChange) {
    const outcome = e.to ?? e.description; // the new value only: "from Routed … to Draft saved" is not a route
    if (/\b(hold|held)\b/i.test(outcome) || /rout/i.test(outcome)) return { score: 0.85, type: 'STOP', signal: 'action' };
    if (/approv|posted|\bpost\b/i.test(outcome)) return { score: 0.1, type: 'WHY', signal: 'approve' };
    return OTHER;
  }
  if (e.kind === 'lookup' || ((e.kind === 'navigated' || e.kind === 'opened') && /history/i.test(`${field} ${e.to ?? ''} ${e.description}`))) {
    return { score: 0.3, type: 'WHY', signal: 'lookup' };
  }
  if (e.kind === 'field_changed' || e.kind === 'typed') {
    if (/cost/i.test(field) || /cost cent/i.test(e.description)) {
      const code = costCenterCode(e);
      return code && code !== defaultCostCenter ? { score: 0.85, type: 'LIMIT', signal: 'deviation' } : OTHER;
    }
    if (/asset/i.test(field) || /asset number/i.test(e.description)) {
      // The ERP default is an empty asset number, so anything entered is a deviation.
      const cleared = e.to !== undefined && /^(|—|-|empty|none|blank)$/i.test(e.to.trim());
      return cleared ? OTHER : { score: 0.85, type: 'LIMIT', signal: 'deviation' };
    }
  }
  return OTHER;
}

/** The expert's words after the agent's most recent question, up to the agent's next turn. */
function answerAfterLastQuestion(transcript: Utterance[]): string | undefined {
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

function text(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
