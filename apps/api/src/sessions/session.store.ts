import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { FrameRef, Session } from '@apprentice/shared';
import { newId, SAFE_ID } from '../common/ids';
import { dataDir } from '../common/paths';

export type NewSession = Pick<Session, 'mode' | 'expert' | 'task'> & Partial<Pick<Session, 'trainee' | 'mapId'>>;

/**
 * Sessions live in memory and are written through to
 *   data/sessions/<id>/session.json
 *   data/sessions/<id>/frames/<frameId>.jpg
 */
@Injectable()
export class SessionStore {
  private readonly root = join(dataDir(), 'sessions');
  private readonly cache = new Map<string, Session>();

  create(init: NewSession): Session {
    const now = Date.now();
    const session: Session = {
      id: newId('s'),
      createdAt: new Date(now).toISOString(),
      startedAtMs: now,
      frames: [],
      events: [],
      transcript: [],
      moments: [],
      answers: [],
      offRecord: [],
      ...init,
    };
    this.save(session);
    return session;
  }

  get(id: string): Session | undefined {
    if (!SAFE_ID.test(id)) return undefined;
    const cached = this.cache.get(id);
    if (cached) return cached;
    const file = this.sessionFile(id);
    if (!existsSync(file)) return undefined;
    const session = JSON.parse(readFileSync(file, 'utf8')) as Session;
    this.cache.set(id, session);
    return session;
  }

  require(id: string): Session {
    const session = this.get(id);
    if (!session) throw new NotFoundException(`Session ${id} not found`);
    return session;
  }

  /** Mutate a session in place and persist it. */
  update(id: string, mutate: (session: Session) => void): Session {
    const session = this.require(id);
    mutate(session);
    this.save(session);
    return session;
  }

  save(session: Session): void {
    this.cache.set(session.id, session);
    mkdirSync(this.dir(session.id), { recursive: true });
    const file = this.sessionFile(session.id);
    writeFileSync(`${file}.tmp`, JSON.stringify(session, null, 2));
    renameSync(`${file}.tmp`, file);
  }

  list(): Session[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => this.get(d.name))
      .filter((s): s is Session => !!s)
      .sort((a, b) => b.startedAtMs - a.startedAtMs);
  }

  /** Stores a JPEG and returns its path relative to the session dir (what goes in FrameRef.path). */
  writeFrame(sessionId: string, frameId: string, jpeg: Buffer): string {
    if (!SAFE_ID.test(frameId)) throw new Error(`Unsafe frame id ${frameId}`);
    const rel = `frames/${frameId}.jpg`;
    mkdirSync(join(this.dir(sessionId), 'frames'), { recursive: true });
    writeFileSync(join(this.dir(sessionId), rel), jpeg);
    return rel;
  }

  /** Sidecar JSON next to a frame (e.g. the vision result for it). */
  writeFrameJson(sessionId: string, frameId: string, data: unknown): void {
    if (!SAFE_ID.test(frameId)) throw new Error(`Unsafe frame id ${frameId}`);
    mkdirSync(join(this.dir(sessionId), 'frames'), { recursive: true });
    writeFileSync(join(this.dir(sessionId), 'frames', `${frameId}.json`), JSON.stringify(data, null, 2));
  }

  /** Removes a frame's JPEG and its sidecar JSON (off-record purge). */
  deleteFrame(sessionId: string, frame: FrameRef): void {
    const jpg = this.frameFile(sessionId, frame.path);
    rmSync(jpg, { force: true });
    rmSync(jpg.replace(/\.jpg$/, '.json'), { force: true });
  }

  /** Absolute path of a stored frame (FrameRef.path is relative). */
  frameFile(sessionId: string, relPath: string): string {
    return join(this.dir(sessionId), relPath);
  }

  private dir(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error(`Unsafe session id ${id}`);
    return join(this.root, id);
  }

  private sessionFile(id: string): string {
    return join(this.dir(id), 'session.json');
  }
}
