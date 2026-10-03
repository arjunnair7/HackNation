import { Injectable, Logger } from '@nestjs/common';
import type { FrameRef, ScreenEvent, ScreenEventsMessage, VisionErrorMessage } from '@apprentice/shared';
import { newId } from '../common/ids';
import { AnthropicService } from '../llm/anthropic.service';
import { MomentsService } from '../moments/moments.service';
import { REPORT_SCREEN_TOOL, VISION_PROMPT, type ReportScreenResult } from '../prompts/vision';
import { EventsGateway } from '../realtime/events.gateway';
import { SessionStore } from '../sessions/session.store';

type ScreenState = Pick<ReportScreenResult, 'screen' | 'entity' | 'state'>;

const EVENT_KINDS: readonly ScreenEvent['kind'][] = ['opened', 'navigated', 'field_changed', 'action', 'lookup', 'typed', 'read', 'other'];

/**
 * Frame → Claude (VISION_MODEL, forced report_screen) → ScreenEvents.
 * Frames are analysed one at a time per session, in order, because each call diffs against
 * the previous state. If frames arrive faster than vision answers, only the newest waiting
 * frame is analysed (it already contains every change since the last analysed one).
 */
@Injectable()
export class VisionService {
  private readonly logger = new Logger(VisionService.name);
  private readonly prevState = new Map<string, ScreenState>();
  private readonly waiting = new Map<string, { frame: FrameRef; jpegBase64: string }>();
  private readonly running = new Set<string>();

  constructor(
    private readonly llm: AnthropicService,
    private readonly store: SessionStore,
    private readonly gateway: EventsGateway,
    private readonly moments: MomentsService,
  ) {}

  enqueue(sessionId: string, frame: FrameRef, jpegBase64: string): void {
    const replaced = this.waiting.get(sessionId);
    if (replaced) this.logger.debug(`${sessionId}: skipping ${replaced.frame.id}, superseded by ${frame.id}`);
    this.waiting.set(sessionId, { frame, jpegBase64 });
    if (!this.running.has(sessionId)) void this.drain(sessionId);
  }

  private async drain(sessionId: string): Promise<void> {
    this.running.add(sessionId);
    try {
      for (let next = this.waiting.get(sessionId); next; next = this.waiting.get(sessionId)) {
        this.waiting.delete(sessionId);
        await this.analyse(sessionId, next.frame, next.jpegBase64);
      }
    } finally {
      this.running.delete(sessionId);
    }
  }

  private async analyse(sessionId: string, frame: FrameRef, jpegBase64: string): Promise<void> {
    const model = process.env.VISION_MODEL || 'claude-haiku-4-5-20251001';
    const prev = this.prevState.get(sessionId);
    const started = Date.now();
    try {
      const result = await this.llm.callTool<ReportScreenResult>({
        model,
        system: VISION_PROMPT,
        tool: REPORT_SCREEN_TOOL,
        maxTokens: 2048,
        content: [
          AnthropicService.jpeg(jpegBase64),
          {
            type: 'text',
            text: `Previous screen state (JSON):\n${prev ? JSON.stringify(prev) : 'none (first frame of the session)'}`,
          },
        ],
      });
      const ms = Date.now() - started;
      this.prevState.set(sessionId, { screen: result.screen, entity: result.entity, state: result.state ?? {} });

      // A different invoice is open: "field changes" would compare two different records.
      const switchedRecord = !!prev?.entity && !!result.entity && prev.entity !== result.entity;
      const reported = (result.events ?? []).filter(
        (e) => (EVENT_KINDS as readonly string[]).includes(e.kind) && e.description && !(switchedRecord && e.kind === 'field_changed'),
      );
      const missed = missedChanges(prev, result, reported);
      if (missed.length) this.logger.log(`${sessionId} ${frame.id}: vision missed ${missed.map((m) => m.field).join(', ')}; added from state`);
      const events: ScreenEvent[] = [...reported, ...missed].map((e) => ({
          id: newId('e'),
          t: frame.t,
          frameId: frame.id,
          kind: e.kind as ScreenEvent['kind'],
          entity: e.entity ?? result.entity,
          field: e.field,
          from: e.from,
          to: e.to,
          description: e.description,
        }));

      this.store.writeFrameJson(sessionId, frame.id, { model, ms, prev: prev ?? null, result });
      if (events.length) this.store.update(sessionId, (s) => s.events.push(...events));

      const message: ScreenEventsMessage = {
        sessionId, frameId: frame.id, t: frame.t, screen: result.screen, entity: result.entity, events, ms,
      };
      this.gateway.emit('screen_events', message);
      if (events.length) this.moments.onEvents(sessionId, events);
      this.logger.log(`${sessionId} ${frame.id} t=${frame.t.toFixed(1)}s ${result.screen} ${result.entity ?? ''}: ${events.length} event(s) in ${ms} ms`);
    } catch (err) {
      const error = (err as Error).message;
      this.logger.warn(`${sessionId} ${frame.id}: vision failed: ${error}`);
      const message: VisionErrorMessage = { sessionId, frameId: frame.id, t: frame.t, error };
      this.gateway.emit('vision_error', message);
    }
  }
}

// --- safety net -------------------------------------------------------------------

type RawEvent = ReportScreenResult['events'][number];

const TRACKED: { field: string; key: RegExp; kind: ScreenEvent['kind']; same: (a: string, b: string) => boolean }[] = [
  { field: 'status', key: /status/i, kind: 'action', same: (a, b) => loose(a) === loose(b) },
  { field: 'cost center', key: /cost.?cent/i, kind: 'field_changed', same: (a, b) => (code(a) ?? loose(a)) === (code(b) ?? loose(b)) },
  { field: 'asset number', key: /asset/i, kind: 'field_changed', same: (a, b) => loose(a) === loose(b) },
];

/**
 * Key fields that changed in `state` on the same open invoice but got no event (seen in testing:
 * a routed invoice's status changed in state while events came back empty).
 */
function missedChanges(prev: ScreenState | undefined, cur: ReportScreenResult, reported: RawEvent[]): RawEvent[] {
  if (!prev || !cur.entity || prev.entity !== cur.entity) return [];
  if (!/detail/i.test(cur.screen) || !/detail/i.test(prev.screen)) return [];
  const out: RawEvent[] = [];
  for (const t of TRACKED) {
    const before = valueOf(prev.state, t.key);
    const after = valueOf(cur.state, t.key);
    if (!after || (before !== undefined && t.same(before, after))) continue;
    if (t.field === 'status' && /^open$/i.test(after)) continue; // the starting state, not a decision
    const covered = reported.some((e) => t.key.test(e.field ?? '') || t.key.test(e.description) || (t.kind === 'action' && e.kind === 'action'));
    if (covered) continue;
    out.push({
      kind: t.kind,
      entity: cur.entity,
      field: t.field,
      from: before,
      to: after,
      description: `${t.field[0].toUpperCase()}${t.field.slice(1)} on ${cur.entity} changed${before ? ` from ${before}` : ''} to ${after}`,
    });
  }
  return out;
}

function valueOf(state: Record<string, unknown> | undefined, key: RegExp): string | undefined {
  const entry = Object.entries(state ?? {}).find(([k, v]) => key.test(k) && (typeof v === 'string' || typeof v === 'number'));
  const value = entry ? String(entry[1]).trim() : undefined;
  return value || undefined;
}

const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const code = (s: string) => s.match(/\b\d{4}\b/)?.[0];
