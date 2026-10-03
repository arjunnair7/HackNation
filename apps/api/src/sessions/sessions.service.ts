import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  CreateSessionRequest,
  FrameRef,
  FrameUploadResponse,
  Mode,
  ScreenEvent,
  ScreenEventsMessage,
  Session,
  Utterance,
} from '@apprentice/shared';
import { newId } from '../common/ids';
import { EventsGateway } from '../realtime/events.gateway';
import { VisionService } from '../vision/vision.service';
import { SessionStore } from './session.store';

const MODES: readonly Mode[] = ['capture', 'debrief', 'teach'];
const EVENT_KINDS: readonly ScreenEvent['kind'][] = ['opened', 'navigated', 'field_changed', 'action', 'lookup', 'typed', 'read', 'other'];
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

const DEFAULT_EXPERT = { name: 'Sabine', role: 'accounts payable lead' };
const DEFAULT_TASK = 'Process supplier invoices before period close';

@Injectable()
export class SessionsService {
  constructor(
    private readonly store: SessionStore,
    private readonly vision: VisionService,
    private readonly gateway: EventsGateway,
  ) {}

  create(body: unknown): Session {
    const b = asObject(body ?? {}) as CreateSessionRequest;
    const mode = b.mode ?? 'capture';
    if (!MODES.includes(mode)) throw new BadRequestException(`mode must be one of: ${MODES.join(', ')}`);
    return this.store.create({
      mode,
      expert: b.expert ?? DEFAULT_EXPERT,
      task: b.task ?? DEFAULT_TASK,
      ...(b.trainee && { trainee: b.trainee }),
      ...(b.mapId && { mapId: b.mapId }),
    });
  }

  addUtterance(sessionId: string, body: unknown): Utterance {
    const b = asObject(body);
    const t = seconds(b.t);
    if (b.role !== 'user' && b.role !== 'agent') throw new BadRequestException('role must be user or agent');
    if (typeof b.text !== 'string' || !b.text.trim()) throw new BadRequestException('text is required');
    let utterance!: Utterance;
    this.store.update(sessionId, (s) => {
      const speaker = b.role === 'agent' ? 'agent' : s.mode === 'teach' ? 'trainee' : 'expert';
      utterance = { id: newId('u'), t, speaker, text: b.text as string, final: true };
      s.transcript.push(utterance);
    });
    return utterance;
  }

  /** Stores the JPEG, records the FrameRef and queues it for vision. Events arrive over the socket. */
  addFrame(sessionId: string, body: unknown): FrameUploadResponse {
    this.store.require(sessionId);
    const b = asObject(body);
    const t = seconds(b.t);
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
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const event: ScreenEvent = {
      id: newId('e'),
      t,
      frameId: 'debug',
      kind: b.kind as ScreenEvent['kind'],
      entity: text(b.entity),
      field: text(b.field),
      from: text(b.from),
      to: text(b.to),
      description: (b.description as string).trim(),
    };
    this.store.update(sessionId, (s) => s.events.push(event));
    const message: ScreenEventsMessage = {
      sessionId, frameId: 'debug', t, screen: 'debug', entity: event.entity, events: [event], ms: 0,
    };
    this.gateway.emit('screen_events', message);
    return event;
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
