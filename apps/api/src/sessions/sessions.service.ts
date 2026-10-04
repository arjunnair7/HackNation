import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import type {
  CreateSessionRequest,
  FrameRef,
  FrameUploadResponse,
  Mode,
  MomentsUpdatedMessage,
  ScreenEvent,
  ScreenEventsMessage,
  Session,
  Utterance,
} from '@apprentice/shared';
import { newId } from '../common/ids';
import { MomentsService } from '../moments/moments.service';
import { OFF_RECORD_TEXT, inOffRecord, isOffRecordNow } from '../privacy/record';
import { redactText } from '../privacy/redact';
import { EventsGateway } from '../realtime/events.gateway';
import { VisionService } from '../vision/vision.service';
import { SessionStore } from './session.store';
import { TeachState } from './teach.state';

const MODES: readonly Mode[] = ['capture', 'debrief', 'teach'];
const EVENT_KINDS: readonly ScreenEvent['kind'][] = ['opened', 'navigated', 'field_changed', 'action', 'lookup', 'typed', 'read', 'other'];
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

const DEFAULT_EXPERT = { name: 'Sabine', role: 'accounts payable lead' };
const DEFAULT_TASK = 'Process supplier invoices before period close';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly store: SessionStore,
    private readonly vision: VisionService,
    private readonly gateway: EventsGateway,
    private readonly moments: MomentsService,
    private readonly teach: TeachState,
  ) {}

  create(body: unknown): Session {
    const b = asObject(body ?? {}) as CreateSessionRequest;
    const mode = b.mode ?? 'capture';
    if (!MODES.includes(mode)) throw new BadRequestException(`mode must be one of: ${MODES.join(', ')}`);
    if (mode === 'teach' && !b.mapId) throw new BadRequestException('A teach session needs the mapId it teaches');
    const session = this.store.create({
      mode,
      expert: b.expert ?? DEFAULT_EXPERT,
      task: b.task ?? DEFAULT_TASK,
      ...(b.trainee && { trainee: b.trainee }),
      ...(b.mapId && { mapId: b.mapId }),
      ...(mode === 'teach' && { mastery: [] }),
    });
    // Phase 8: the newest teach session is the active one (save gate + risk checks use its map).
    if (mode === 'teach') this.teach.activeSessionId = session.id;
    return session;
  }

  /** End training: the save gate switches off. */
  end(sessionId: string): { ended: true } {
    this.store.require(sessionId);
    if (this.teach.activeSessionId === sessionId) this.teach.activeSessionId = undefined;
    return { ended: true };
  }

  addUtterance(sessionId: string, body: unknown): Utterance {
    const b = asObject(body);
    const t = seconds(b.t);
    if (b.role !== 'user' && b.role !== 'agent') throw new BadRequestException('role must be user or agent');
    if (typeof b.text !== 'string' || !b.text.trim()) throw new BadRequestException('text is required');
    let utterance!: Utterance;
    this.store.update(sessionId, (s) => {
      const speaker = b.role === 'agent' ? 'agent' : s.mode === 'teach' ? 'trainee' : 'expert';
      const off = inOffRecord(s, t);
      const text = off ? OFF_RECORD_TEXT : redactText(b.text as string);
      utterance = { id: newId('u'), t, speaker, text, final: true, ...(off && { offRecord: true }) };
      s.transcript.push(utterance);
    });
    return utterance;
  }

  /** Stores the JPEG, records the FrameRef and queues it for vision. Events arrive over the socket. */
  addFrame(sessionId: string, body: unknown): FrameUploadResponse {
    const session = this.store.require(sessionId);
    const b = asObject(body);
    const t = seconds(b.t);
    if (inOffRecord(session, t)) return { dropped: true };
    if (typeof b.jpegBase64 !== 'string') throw new BadRequestException('jpegBase64 is required');
    const base64 = b.jpegBase64.replace(/^data:image\/jpeg;base64,/, '');
    const jpeg = Buffer.from(base64, 'base64');
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new BadRequestException('jpegBase64 is not a JPEG');
    if (jpeg.length > MAX_FRAME_BYTES) throw new BadRequestException('frame is too large');

    const id = newId('f');
    const frame: FrameRef = { id, t, path: this.store.writeFrame(sessionId, id, jpeg), redacted: false };
    this.store.update(sessionId, (s) => s.frames.push(frame));
    this.vision.enqueue(sessionId, frame, base64);
    return { frameId: id };
  }

  /** Debug drawer: a hand-made screen event that takes the same path as a vision event. */
  addDebugEvent(sessionId: string, body: unknown): ScreenEvent {
    const b = asObject(body);
    if (!EVENT_KINDS.includes(b.kind as ScreenEvent['kind'])) {
      throw new BadRequestException(`kind must be one of: ${EVENT_KINDS.join(', ')}`);
    }
    if (typeof b.description !== 'string' || !b.description.trim()) throw new BadRequestException('description is required');
    const session = this.store.require(sessionId);
    const t = b.t === undefined ? (Date.now() - session.startedAtMs) / 1000 : seconds(b.t);
    if (inOffRecord(session, t)) throw new ConflictException('Off the record: nothing is captured');
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? redactText(v.trim()) : undefined);
    const event: ScreenEvent = {
      id: newId('e'),
      t,
      frameId: 'debug',
      kind: b.kind as ScreenEvent['kind'],
      entity: text(b.entity),
      field: text(b.field),
      from: text(b.from),
      to: text(b.to),
      description: redactText((b.description as string).trim()),
    };
    this.store.update(sessionId, (s) => s.events.push(event));
    const message: ScreenEventsMessage = {
      sessionId, frameId: 'debug', t, screen: 'debug', entity: event.entity, events: [event], ms: 0,
    };
    this.gateway.emit('screen_events', message);
    this.moments.onEvents(sessionId, [event]);
    return event;
  }

  /**
   * { from } opens an off-record window and purges everything already captured from `from` on
   * (frames, screen events, moments, answers; utterances are blanked). { to } closes it.
   * Either way the vision state is forgotten, so the first frame back is not diffed against
   * anything from before (which would describe what happened off the record).
   */
  setOffRecord(sessionId: string, body: unknown): Session['offRecord'] {
    const b = asObject(body);
    const session = this.store.update(sessionId, (s) => {
      if (b.from !== undefined) {
        const from = seconds(b.from);
        if (isOffRecordNow(s)) return;
        s.offRecord.push({ from });
        this.purge(s, from);
      } else if (b.to !== undefined) {
        const open = s.offRecord.find((w) => w.to === undefined);
        if (open) open.to = Math.max(open.from, seconds(b.to));
      } else {
        throw new BadRequestException('Expected { from } or { to }');
      }
    });
    this.vision.forget(sessionId);
    this.emitMoments(session);
    return session.offRecord;
  }

  /** The expert removes one utterance, screen event or answer from the record. */
  strike(sessionId: string, body: unknown): string[] {
    const b = asObject(body);
    if (typeof b.id !== 'string' || !b.id) throw new BadRequestException('id is required');
    const id = b.id;
    const session = this.store.update(sessionId, (s) => {
      const known = s.transcript.some((u) => u.id === id) || s.events.some((e) => e.id === id) || s.answers.some((a) => a.id === id);
      if (!known) throw new BadRequestException(`Nothing with id ${id} in this session`);
      s.struck = [...new Set([...(s.struck ?? []), id])];
      // A moment built only from struck events has nothing left to ask about.
      for (const m of s.moments) m.eventIds = m.eventIds.filter((e) => e !== id);
      s.moments = s.moments.filter((m) => m.eventIds.length > 0);
    });
    this.emitMoments(session);
    return session.struck ?? [];
  }

  private purge(s: Session, from: number): void {
    const dropped = s.frames.filter((f) => f.t >= from);
    for (const f of dropped) this.store.deleteFrame(s.id, f);
    const droppedIds = new Set(dropped.map((f) => f.id));
    s.frames = s.frames.filter((f) => !droppedIds.has(f.id));
    const goneEvents = new Set(s.events.filter((e) => e.t >= from || droppedIds.has(e.frameId)).map((e) => e.id));
    s.events = s.events.filter((e) => !goneEvents.has(e.id));
    for (const m of s.moments) m.eventIds = m.eventIds.filter((e) => !goneEvents.has(e));
    s.moments = s.moments.filter((m) => m.t < from && m.eventIds.length > 0);
    s.answers = s.answers.filter((a) => a.t < from);
    for (const u of s.transcript) {
      if (u.t >= from) Object.assign(u, { text: OFF_RECORD_TEXT, offRecord: true });
    }
    this.logger.log(`${s.id}: off the record from ${from}s, purged ${dropped.length} frame(s) and ${goneEvents.size} event(s)`);
  }

  private emitMoments(session: Session): void {
    const message: MomentsUpdatedMessage = { sessionId: session.id, moments: session.moments };
    this.gateway.emit('moments_updated', message);
  }
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Expected a JSON object body');
  }
  return body as Record<string, unknown>;
}

function seconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new BadRequestException('t must be a non-negative number of seconds since session start');
  }
  return Math.round(value * 100) / 100;
}
