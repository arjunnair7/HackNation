import type { Session } from '@apprentice/shared';

/** Placeholder stored instead of anything said inside an off-record window. */
export const OFF_RECORD_TEXT = '[off the record]';

/** Is session time t inside an off-record window (open windows run to now)? */
export function inOffRecord(session: Session, t: number): boolean {
  return session.offRecord.some((w) => t >= w.from && (w.to === undefined || t <= w.to));
}

export function isOffRecordNow(session: Session): boolean {
  return session.offRecord.some((w) => w.to === undefined);
}

/**
 * The session as everything downstream may see it (map builder, tutor, exports): nothing from
 * off-record windows, nothing the expert struck. Off-record content is also purged when a window
 * opens; this filter is the second line of defence.
 */
export function onRecord(session: Session): Session {
  const struck = new Set(session.struck ?? []);
  const keep = (item: { id: string; t: number }) => !struck.has(item.id) && !inOffRecord(session, item.t);
  const events = session.events.filter(keep);
  const eventIds = new Set(events.map((e) => e.id));
  return {
    ...session,
    frames: session.frames.filter(keep),
    events,
    transcript: session.transcript.filter((u) => keep(u) && !u.offRecord),
    moments: session.moments
      .filter(keep)
      .map((m) => ({ ...m, eventIds: m.eventIds.filter((id) => eventIds.has(id)) }))
      .filter((m) => m.eventIds.length > 0),
    answers: session.answers.filter(keep),
  };
}
