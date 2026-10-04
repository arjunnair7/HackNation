import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  Answer,
  ErpContext,
  Guardrail,
  GuardrailKind,
  MapDraftResponse,
  MapSummary,
  MapUpdatedMessage,
  OpenQuestion,
  ReadyForTeachbackMessage,
  Session,
  Step,
  TutorMapResponse,
  WorkMap,
} from '@apprentice/shared';
import { newId, SAFE_ID } from '../common/ids';
import { dataDir } from '../common/paths';
import { answerAfterLastQuestion } from '../common/transcript';
import { ErpService } from '../erp/erp.service';
import { AnthropicService } from '../llm/anthropic.service';
import { onRecord } from '../privacy/record';
import { redactText } from '../privacy/redact';
import {
  APPLY_ANSWER_PROMPT,
  APPLY_CORRECTION_PROMPT,
  BUILD_WORK_MAP_TOOL,
  ERP_CONTEXT_TS,
  MAP_BUILDER_PROMPT,
  UPDATE_WORK_MAP_TOOL,
  type BuildWorkMapResult,
  type RawGuardrail,
  type RawQuote,
  type RawStep,
  type UpdateWorkMapResult,
} from '../prompts/workmap';
import { EventsGateway } from '../realtime/events.gateway';
import { SessionStore } from '../sessions/session.store';
import { renderCompact, renderForTutor } from './render';
import { validRule } from './rules';

const MIN_OPEN_QUESTIONS = 3;
const ANSWER_SETTLE_MS = 1500; // record_answer can race the expert's last transcript line
const GUARDRAIL_KINDS: readonly GuardrailKind[] = ['limit', 'exception', 'stop_and_ask', 'never', 'rule'];
const SAMPLE_INVOICES = ['INV-4471', 'INV-4472', 'INV-4473', 'INV-4474', 'INV-5102', 'INV-5103', 'INV-5104', 'INV-5105'];

interface Source { text: string; t: number; source: 'live' | 'debrief' | 'narration' }

/**
 * Q3 "when has it understood": draft map → debrief answers → teach-back corrections → confirm.
 * The model proposes; the server keeps it honest: every quote must be words the expert said
 * (checked against the on-record transcript and answers), every screen moment a real frame, every
 * rule ErpContext-only JSONLogic, and coverage is counted here, not by the model.
 */
@Injectable()
export class WorkMapService {
  private readonly logger = new Logger(WorkMapService.name);
  private readonly root = join(dataDir(), 'maps');
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: SessionStore,
    private readonly llm: AnthropicService,
    private readonly erp: ErpService,
    private readonly gateway: EventsGateway,
  ) {}

  private get model(): string {
    return process.env.MAP_MODEL || 'claude-sonnet-5-5';
  }

  // --- public operations ------------------------------------------------------------

  draft(sessionId: string): Promise<MapDraftResponse> {
    return this.locked(sessionId, async () => {
      const session = this.store.require(sessionId);
      const existing = session.mapId ? this.load(session.mapId) : undefined;
      if (existing?.teachback.status === 'confirmed') throw new ConflictException('The Work Map is already confirmed');

      const rec = onRecord(session);
      const started = Date.now();
      let raw = await this.callBuilder(rec, '');
      if (raw.openQuestions.length < MIN_OPEN_QUESTIONS) {
        this.logger.warn(`${sessionId}: only ${raw.openQuestions.length} open questions, asking again`);
        raw = await this.callBuilder(rec, `\n\nYour previous answer had only ${raw.openQuestions.length} open questions. Return at least ${MIN_OPEN_QUESTIONS}.`);
      }

      const { steps, guardrails } = this.normalize(raw, rec);
      const stepIds = new Set(steps.map((s) => s.id));
      const openQuestions: OpenQuestion[] = raw.openQuestions.map((q, i) => ({
        id: `q${i + 1}`,
        question: redactText(q.question),
        why: redactText(q.why),
        ...(q.relatedStepId && stepIds.has(q.relatedStepId) && { relatedStepId: q.relatedStepId }),
        status: 'open',
      }));
      const map: WorkMap = {
        id: existing?.id ?? newId('map'),
        sessionId,
        version: 1,
        task: session.task,
        expert: session.expert,
        steps,
        guardrails,
        openQuestions,
        teachback: { status: 'pending', corrections: [] },
        coverage: coverageOf(steps, guardrails, []),
        struck: [],
      };
      this.save(map);
      this.store.update(sessionId, (s) => {
        s.mapId = map.id;
        s.mode = 'debrief';
      });
      this.logger.log(
        `${sessionId}: map ${map.id} in ${((Date.now() - started) / 1000).toFixed(1)} s: ${steps.length} steps, ${guardrails.length} guardrails, ${openQuestions.length} open questions`,
      );
      this.emit(map);
      return { map, compact: renderCompact(map) };
    });
  }

  get(sessionId: string): WorkMap {
    const session = this.store.require(sessionId);
    const map = session.mapId ? this.load(session.mapId) : undefined;
    if (!map) throw new NotFoundException(`Session ${sessionId} has no Work Map yet`);
    return map;
  }

  getById(mapId: string): WorkMap {
    const map = this.load(mapId);
    if (!map) throw new NotFoundException(`Work Map ${mapId} not found`);
    return map;
  }

  /** Every map, newest confirmed first (the "teach from" picker). */
  list(): MapSummary[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.load(f.replace(/\.json$/, '')))
      .filter((m): m is WorkMap => !!m)
      .map((m) => ({
        id: m.id, sessionId: m.sessionId, version: m.version, expert: m.expert,
        steps: m.steps.filter((s) => !m.struck.includes(s.id)).length,
        guardrails: m.guardrails.filter((g) => !m.struck.includes(g.id)).length,
        teachback: m.teachback.status, confirmedAt: m.teachback.confirmedAt,
      }))
      .sort((a, b) => Number(b.teachback === 'confirmed') - Number(a.teachback === 'confirmed') || (b.confirmedAt ?? '').localeCompare(a.confirmedAt ?? ''));
  }

  /** The map plus the tutor's {{work_map}} text. */
  tutor(mapId: string): TutorMapResponse {
    const map = this.getById(mapId);
    return { map, tutorText: renderForTutor(map) };
  }

  /** record_answer with an open-question id (or Skip): close the question, then fold the answer into the map. */
  answer(sessionId: string, body: unknown): Promise<WorkMap> {
    const b = asObject(body);
    if (typeof b.questionId !== 'string') throw new BadRequestException('questionId is required');
    return this.locked(sessionId, async () => {
      // A skip only closes the question, so it is allowed on a confirmed map; answers are not.
      const map = b.skip === true ? this.get(sessionId) : this.unlocked(sessionId);
      const asked = b.questionId!.toString().replace(/^id=/, '').trim();
      const question = map.openQuestions.find((q) => q.id === asked) ?? map.openQuestions.find((q) => q.status === 'open');
      if (!question) throw new BadRequestException(`No open question ${asked}`);

      if (b.skip === true) {
        question.status = 'skipped';
        this.save(map);
        this.emit(map);
        this.maybeReady(map);
        return map;
      }

      await sleep(ANSWER_SETTLE_MS);
      const session = this.store.require(sessionId);
      const rec = onRecord(session);
      const quote = redactText(answerAfterLastQuestion(rec.transcript) ?? String(b.reasonQuote ?? '').trim());
      if (!quote) throw new BadRequestException('No answer found in the transcript and no reasonQuote given');
      const answer: Answer = {
        id: newId('a'),
        momentOrQuestionId: question.id,
        t: (Date.now() - session.startedAtMs) / 1000,
        quote,
        source: 'debrief',
      };
      this.store.update(sessionId, (s) => s.answers.push(answer));
      question.status = 'answered';
      question.answerQuote = quote;
      this.save(map);
      this.emit(map); // tick the question off right away; the map update follows

      const updated = await this.callUpdate(
        APPLY_ANSWER_PROMPT,
        `${this.mapJson(map)}\n\nOpen question ${question.id}: ${question.question}\nWhy it matters: ${question.why}\n\nThe expert's answer [${answer.id}]: "${quote}"`,
      );
      this.apply(map, updated, onRecord(this.store.require(sessionId)));
      this.save(map);
      this.emit(map);
      this.maybeReady(map);
      return map;
    });
  }

  /** submit_correction during the teach-back. The correction is the expert's own words when the transcript has them. */
  correction(sessionId: string, body: unknown): Promise<WorkMap> {
    const b = asObject(body);
    return this.locked(sessionId, async () => {
      const map = this.unlocked(sessionId);
      await sleep(ANSWER_SETTLE_MS);
      const rec = onRecord(this.store.require(sessionId));
      const text = redactText(answerAfterLastQuestion(rec.transcript) ?? String(b.correction ?? '').trim());
      if (!text) throw new BadRequestException('correction is required');
      map.teachback = { ...map.teachback, status: 'corrected', corrections: [...map.teachback.corrections, text] };
      this.save(map);
      this.emit(map);

      const updated = await this.callUpdate(APPLY_CORRECTION_PROMPT, `${this.mapJson(map)}\n\nThe expert's correction: "${text}"`);
      this.apply(map, updated, rec, { correction: { text, t: (Date.now() - rec.startedAtMs) / 1000, source: 'debrief' } });
      this.save(map);
      this.emit(map);
      return map;
    });
  }

  /**
   * Strike a step or guardrail from the record (or restore it). Allowed on a confirmed map: it changes
   * nothing the expert said, it only keeps the item out of the tutor and exports. Coverage is recounted.
   */
  strike(sessionId: string, body: unknown): Promise<WorkMap> {
    const b = asObject(body);
    if (typeof b.id !== 'string' || typeof b.struck !== 'boolean') throw new BadRequestException('Expected { id, struck }');
    return this.locked(sessionId, async () => {
      const map = this.get(sessionId);
      if (!map.steps.some((s) => s.id === b.id) && !map.guardrails.some((g) => g.id === b.id)) {
        throw new BadRequestException(`No step or guardrail ${String(b.id)}`);
      }
      const struck = new Set(map.struck);
      if (b.struck) struck.add(b.id as string);
      else struck.delete(b.id as string);
      map.struck = [...struck];
      map.coverage = coverageOf(map.steps, map.guardrails, map.struck);
      this.save(map);
      this.emit(map);
      return map;
    });
  }

  /** confirm_teachback: lock the map. */
  confirm(sessionId: string): Promise<WorkMap> {
    return this.locked(sessionId, async () => {
      const map = this.unlocked(sessionId);
      map.teachback = { ...map.teachback, status: 'confirmed', confirmedAt: new Date().toISOString() };
      map.version += 1;
      map.coverage = coverageOf(map.steps, map.guardrails, map.struck);
      this.save(map);
      this.emit(map);
      this.logger.log(`${sessionId}: map ${map.id} confirmed (v${map.version})`);
      return map;
    });
  }

  // --- model calls ------------------------------------------------------------------

  private callBuilder(rec: Session, extra: string): Promise<BuildWorkMapResult> {
    return this.llm.callTool<BuildWorkMapResult>({
      model: this.model,
      system: MAP_BUILDER_PROMPT + extra,
      tool: BUILD_WORK_MAP_TOOL,
      effort: 'medium',
      content: this.builderInput(rec),
    });
  }

  private callUpdate(system: string, content: string): Promise<UpdateWorkMapResult> {
    return this.llm.callTool<UpdateWorkMapResult>({
      model: this.model,
      system: `${system}\n\nErpContext:\n${ERP_CONTEXT_TS}`,
      tool: UPDATE_WORK_MAP_TOOL,
      effort: 'low',
      content,
    });
  }

  private builderInput(rec: Session): string {
    const events = rec.events
      .map((e) => `[t=${e.t.toFixed(1)}s ${e.frameId}] ${e.kind}${e.entity ? ` ${e.entity}` : ''}: ${e.description}`)
      .join('\n');
    const transcript = rec.transcript
      .map((u) => `[${u.id} t=${u.t.toFixed(1)}s ${u.speaker}] ${u.text}`)
      .join('\n');
    const answers = rec.answers
      .map((a) => `[${a.id} t=${a.t.toFixed(1)}s ${a.source}, about ${a.momentOrQuestionId}] "${a.quote}"${a.guardrailText ? ` (guardrail stated: ${a.guardrailText})` : ''}`)
      .join('\n');
    const unasked = rec.moments
      .filter((m) => m.score >= 0.6 && m.status !== 'answered' && !m.coveredByNarration)
      .map((m) => `- (${m.suggestedType}) ${m.entity ?? ''} ${m.summary}`)
      .join('\n');
    const sample = this.erp.getContext('INV-4471');
    return [
      `Task: ${rec.task}`,
      `Expert: ${rec.expert.name}, ${rec.expert.role}`,
      `\nScreen events (time, frame, kind, invoice: what changed):\n${events || '(none)'}`,
      `\nTranscript (final lines, on the record):\n${transcript || '(none)'}`,
      `\nRecorded answers:\n${answers || '(none)'}`,
      `\nDecisions the apprentice saw but never got a reason for:\n${unasked || '(none)'}`,
      `\nErpContext:\n${ERP_CONTEXT_TS}`,
      `\nSample invoice as ErpContext (INV-4471 before coding):\n${JSON.stringify(sample)}`,
    ].join('\n');
  }

  private mapJson(map: WorkMap): string {
    const view = {
      steps: map.steps.map(({ order: _order, ...s }) => ({ ...s, ...(s.reason && { reason: { quote: s.reason.quote } }) })),
      guardrails: map.guardrails,
    };
    return `Current Work Map (JSON):\n${JSON.stringify(view)}`;
  }

  // --- keeping the model honest -----------------------------------------------------

  private normalize(raw: { steps: RawStep[]; guardrails: RawGuardrail[] }, rec: Session, extraSources: Record<string, Source> = {}) {
    const sources = new Map<string, Source>(Object.entries(extraSources));
    for (const u of rec.transcript) if (u.speaker === 'expert') sources.set(u.id, { text: u.text, t: u.t, source: 'narration' });
    for (const a of rec.answers) sources.set(a.id, { text: a.quote, t: a.t, source: a.source });
    const frames = rec.frames;
    const samples = this.samples();

    const guardrailIds = new Map<string, string>();
    const guardrails: Guardrail[] = [];
    for (const g of raw.guardrails ?? []) {
      const id = uniqueId('g', g.id, guardrails.map((x) => x.id));
      guardrailIds.set(g.id, id);
      const quote = verifyQuote({ quote: g.quote, quoteRef: g.quoteRef }, sources);
      const moment = g.screenMoment ? frameFor(g.screenMoment.t, g.screenMoment.frameId, frames) : undefined;
      const violatedWhen = validRule(g.violatedWhen, samples);
      if (g.violatedWhen && !violatedWhen) this.logger.warn(`dropped rule on ${id}: ${JSON.stringify(g.violatedWhen).slice(0, 200)}`);
      guardrails.push({
        id,
        kind: GUARDRAIL_KINDS.includes(g.kind) ? g.kind : 'rule',
        text: redactText(g.text),
        quote: quote?.quote ?? '',
        t: quote?.t ?? moment?.t ?? 0,
        ...(moment && { screenMoment: moment }),
        ...(violatedWhen && { violatedWhen }),
      });
    }

    const steps: Step[] = [];
    for (const s of raw.steps ?? []) {
      const id = uniqueId('s', s.id, steps.map((x) => x.id));
      const reason = s.reason ? verifyQuote(s.reason, sources) : undefined;
      const moment = frameFor(s.screenMoment?.t ?? 0, s.screenMoment?.frameId, frames);
      const appliesWhen = s.judgmentCall ? validRule(s.appliesWhen, samples) : undefined;
      steps.push({
        id,
        order: steps.length + 1,
        title: redactText(s.title),
        screenMoment: { ...moment, ...(s.screenMoment?.entity && { entity: s.screenMoment.entity }), ...(s.screenMoment?.field && { field: s.screenMoment.field }) },
        decision: redactText(s.decision),
        judgmentCall: s.judgmentCall === true,
        ...(reason && { reason }),
        guardrailIds: (s.guardrailIds ?? []).map((g) => guardrailIds.get(g)).filter((g): g is string => !!g),
        ...(appliesWhen && { appliesWhen }),
      });
    }
    // Every guardrail links to a screen moment: the step that uses it, else the frame nearest its quote.
    for (const g of guardrails) {
      if (g.screenMoment?.frameId) continue;
      const step = steps.find((s) => s.guardrailIds.includes(g.id));
      const moment = step ? { t: step.screenMoment.t, frameId: step.screenMoment.frameId } : frameFor(g.t, undefined, frames);
      if (moment.frameId) g.screenMoment = moment;
    }
    return { steps, guardrails };
  }

  private apply(map: WorkMap, updated: UpdateWorkMapResult, rec: Session, extraSources: Record<string, Source> = {}): void {
    const { steps, guardrails } = this.normalize(updated, rec, extraSources);
    map.steps = steps;
    map.guardrails = guardrails;
    map.coverage = coverageOf(steps, guardrails, map.struck);
  }

  private samples(): ErpContext[] {
    return SAMPLE_INVOICES.flatMap((id) => {
      try {
        return [this.erp.getContext(id)];
      } catch {
        return [];
      }
    });
  }

  // --- plumbing ------------------------------------------------------------------------

  private unlocked(sessionId: string): WorkMap {
    const map = this.get(sessionId);
    if (map.teachback.status === 'confirmed') throw new ConflictException('The Work Map is confirmed and locked');
    return map;
  }

  private maybeReady(map: WorkMap): void {
    if (map.openQuestions.some((q) => q.status === 'open')) return;
    const message: ReadyForTeachbackMessage = { sessionId: map.sessionId, map, compact: renderCompact(map) };
    this.gateway.emit('ready_for_teachback', message);
  }

  private emit(map: WorkMap): void {
    const message: MapUpdatedMessage = { sessionId: map.sessionId, map, compact: renderCompact(map) };
    this.gateway.emit('map_updated', message);
  }

  /** One map operation at a time per session (answers can arrive while a model call runs). */
  private locked<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(sessionId) ?? Promise.resolve()).then(fn, fn);
    this.locks.set(sessionId, run.catch(() => undefined));
    return run;
  }

  private load(mapId: string): WorkMap | undefined {
    if (!SAFE_ID.test(mapId)) return undefined;
    const file = join(this.root, `${mapId}.json`);
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as WorkMap) : undefined;
  }

  private save(map: WorkMap): void {
    mkdirSync(this.root, { recursive: true });
    const file = join(this.root, `${map.id}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(map, null, 2));
    renameSync(`${file}.tmp`, file);
  }
}

// --- helpers ------------------------------------------------------------------------------

function coverageOf(steps: Step[], guardrails: Guardrail[], struck: string[]): WorkMap['coverage'] {
  const live = (x: { id: string }) => !struck.includes(x.id);
  const s = steps.filter(live);
  const g = guardrails.filter(live);
  return {
    steps: s.length,
    stepsWithReason: s.filter((x) => x.reason).length,
    guardrails: g.length,
    guardrailsWithSource: g.filter((x) => x.quote).length,
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9€]+/g, ' ').trim();

/**
 * The quote must be words the expert said. Accept it if it appears in the cited source (or any
 * source); if the model paraphrased, fall back to the cited line in full; otherwise no quote.
 */
function verifyQuote(q: RawQuote, sources: Map<string, Source>): Step['reason'] | undefined {
  const quote = (q.quote ?? '').trim();
  const cited = q.quoteRef ? sources.get(q.quoteRef) : undefined;
  const contains = (s: Source) => norm(s.text).includes(norm(quote));
  if (quote) {
    // A recorded answer wins over the same words in the plain transcript: its source (live question,
    // debrief) is what the Work Map shows, not "said while working".
    const answer = [...sources.values()].find((s) => s.source !== 'narration' && contains(s));
    if (answer) return { quote, t: answer.t, source: answer.source };
    if (cited && contains(cited)) return { quote, t: cited.t, source: cited.source };
    const said = [...sources.values()].find(contains);
    if (said) return { quote, t: said.t, source: said.source };
  }
  return cited ? { quote: cited.text, t: cited.t, source: cited.source } : undefined;
}

/** A real frame: the one cited if it exists, else the nearest on-record frame to t. */
function frameFor(t: number, frameId: string | undefined, frames: Session['frames']): { t: number; frameId: string } {
  const cited = frames.find((f) => f.id === frameId);
  if (cited) return { t: cited.t, frameId: cited.id };
  const nearest = frames.reduce<Session['frames'][number] | undefined>((best, f) => (!best || Math.abs(f.t - t) < Math.abs(best.t - t) ? f : best), undefined);
  return nearest ? { t: nearest.t, frameId: nearest.id } : { t, frameId: '' };
}

function uniqueId(prefix: string, proposed: string | undefined, taken: string[]): string {
  if (proposed && new RegExp(`^${prefix}\\d+$`).test(proposed) && !taken.includes(proposed)) return proposed;
  let n = taken.length + 1;
  while (taken.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new BadRequestException('Expected a JSON object body');
  return body as Record<string, unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
