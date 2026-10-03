import { Injectable, Logger } from '@nestjs/common';
import type { FrameRef, ScreenEvent, ScreenEventsMessage, VisionErrorMessage } from '@apprentice/shared';
import { newId } from '../common/ids';
import { AnthropicService } from '../llm/anthropic.service';
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

      const events: ScreenEvent[] = (result.events ?? [])
        .filter((e) => (EVENT_KINDS as readonly string[]).includes(e.kind) && e.description)
        .map((e) => ({
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
      this.logger.log(`${sessionId} ${frame.id} t=${frame.t.toFixed(1)}s ${result.screen} ${result.entity ?? ''}: ${events.length} event(s) in ${ms} ms`);
    } catch (err) {
      const error = (err as Error).message;
      this.logger.warn(`${sessionId} ${frame.id}: vision failed: ${error}`);
      const message: VisionErrorMessage = { sessionId, frameId: frame.id, t: frame.t, error };
      this.gateway.emit('vision_error', message);
    }
  }
}
