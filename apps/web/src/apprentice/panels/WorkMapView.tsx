import { useEffect, useRef, useState } from 'react'
import type { Guardrail, GuardrailKind, Session, Step, Utterance, WorkMap } from '@apprentice/shared'
import { api } from '../lib/api.ts'
import { formatT } from '../lib/clock.ts'
import { ReplayModal, type ReplayTarget } from './ReplayModal.tsx'

export const KIND_LABEL: Record<GuardrailKind, string> = {
  limit: 'Limit',
  exception: 'Exception',
  stop_and_ask: 'Stop and ask',
  never: 'Never',
  rule: 'Rule',
}
const SOURCE_LABEL = { live: 'live question', debrief: 'debrief', narration: 'said while working' } as const
const SAID_HERE_S = 15

interface Props {
  sessionId: string
  map: WorkMap
  expertName: string
  /** Remove / restore an item (omit for a read-only view). */
  onStrike?: (id: string, struck: boolean) => void
  /** Link to the standalone /map page (shown inside the apprentice panel). */
  showOpenLink?: boolean
}

/** Phase 7: the Work Map as a clickable timeline; every card replays its screen moment and the expert's words. */
export function WorkMapView({ sessionId, map, expertName, onStrike, showOpenLink }: Props) {
  const session = useSession(sessionId, map)
  const [replay, setReplay] = useState<ReplayTarget | null>(null)
  const changed = useChangedIds(map)

  const struck = new Set(map.struck)
  const liveSteps = map.steps.filter((s) => !struck.has(s.id))
  const liveGuardrails = map.guardrails.filter((g) => !struck.has(g.id))
  const words = expertWords(session)
  const frames = session?.frames ?? []
  const guardrailById = new Map(map.guardrails.map((g) => [g.id, g]))

  // Maps drafted before the server preferred answers may label a debrief answer "said while working".
  const reasonOf = (s: Step) => {
    if (!s.reason) return undefined
    const quote = s.reason.quote.toLowerCase()
    const answer = session?.answers.find((a) => a.source !== 'narration' && a.quote.toLowerCase().includes(quote))
    return answer ? { ...s.reason, source: answer.source, t: answer.t } : s.reason
  }

  const stepTarget = (s: Step): ReplayTarget => {
    const n = liveSteps.findIndex((x) => x.id === s.id) + 1
    return {
      kind: struck.has(s.id) ? 'Step (removed)' : `Step ${n}/${liveSteps.length}`,
      title: s.title,
      moment: s.screenMoment,
      quote: reasonOf(s) ? { text: reasonOf(s)!.quote, label: `${SOURCE_LABEL[reasonOf(s)!.source]} at ${formatT(reasonOf(s)!.t)}` } : undefined,
    }
  }
  const guardrailTarget = (g: Guardrail): ReplayTarget => ({
    kind: `Guardrail · ${KIND_LABEL[g.kind]}`,
    title: g.text,
    moment: guardrailMoment(g, map.steps, frames),
    quote: g.quote ? { text: g.quote, label: `said at ${formatT(g.t)}` } : undefined,
  })

  return (
    <section className="appr-card workmap">
      <div className="card-head">
        <h2>Work Map</h2>
        <div className="workmap-actions">
          {showOpenLink && (
            <a className="appr-btn appr-btn-small" href={`/map/${sessionId}`} target="_blank" rel="noreferrer">
              Open full map ↗
            </a>
          )}
          <button type="button" className="appr-btn appr-btn-small" onClick={() => exportJson(map)}>
            Export JSON
          </button>
        </div>
      </div>
      <p className="workmap-summary">
        {liveSteps.length} steps · {liveSteps.filter((s) => s.judgmentCall).length} judgment calls · {liveGuardrails.length}{' '}
        guardrails · teach-back {map.teachback.status}
        {map.struck.length > 0 && ` · ${map.struck.length} removed`}
      </p>

      <ol className="timeline">
        {map.steps.map((s) => {
          const removed = struck.has(s.id)
          const reason = reasonOf(s)
          const said = reason ? undefined : nearestWords(words, s.screenMoment.t)
          return (
            <li key={s.id} className={`tl-item${removed ? ' tl-removed' : ''}${changed.has(s.id) ? ' flash' : ''}`}>
              <button type="button" className="tl-card" onClick={() => setReplay(stepTarget(s))}>
                <span className="tl-head">
                  <span className="signal-label">
                    {removed ? 'Removed' : `Step ${liveSteps.findIndex((x) => x.id === s.id) + 1}/${liveSteps.length}`} ·{' '}
                    {formatT(s.screenMoment.t)}
                  </span>
                  {s.judgmentCall && <span className="type type-LIMIT">judgment call</span>}
                </span>
                <strong className="tl-title">{s.title}</strong>
                <span className="tl-decision">{s.decision}</span>
                {reason ? (
                  <span className="tl-quote">
                    "{reason.quote}"
                    <cite>
                      {SOURCE_LABEL[reason.source]} at {formatT(reason.t)}
                    </cite>
                  </span>
                ) : said ? (
                  <span className="tl-said">
                    No reason given. Said here: "{said.text}" <cite>at {formatT(said.t)}</cite>
                  </span>
                ) : (
                  <span className="tl-said">No reason in {expertName}'s words yet.</span>
                )}
              </button>
              <div className="tl-foot">
                {s.guardrailIds.map((id) => {
                  const g = guardrailById.get(id)
                  if (!g) return null
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`chip-kind kind-${g.kind}${struck.has(id) ? ' chip-removed' : ''}`}
                      onClick={() => setReplay(guardrailTarget(g))}
                      title={g.text}
                    >
                      {KIND_LABEL[g.kind]}: {g.text}
                    </button>
                  )
                })}
                {onStrike && <StrikeButton removed={removed} onClick={() => onStrike(s.id, !removed)} />}
              </div>
            </li>
          )
        })}
      </ol>

      <h3>Guardrails</h3>
      <ul className="guardrail-cards">
        {map.guardrails.map((g) => {
          const removed = struck.has(g.id)
          return (
            <li key={g.id} className={`gr-card kind-border-${g.kind}${removed ? ' tl-removed' : ''}${changed.has(g.id) ? ' flash' : ''}`}>
              <button type="button" className="tl-card" onClick={() => setReplay(guardrailTarget(g))}>
                <span className="tl-head">
                  <span className={`chip-kind kind-${g.kind}`}>{KIND_LABEL[g.kind]}</span>
                  <span className="signal-label">{removed ? 'Removed' : formatT(guardrailMoment(g, map.steps, frames).t)}</span>
                </span>
                <strong className="tl-title">{g.text}</strong>
                {g.quote ? (
                  <span className="tl-quote">
                    "{g.quote}"<cite>said at {formatT(g.t)}</cite>
                  </span>
                ) : (
                  <span className="tl-said">No source quote.</span>
                )}
              </button>
              {onStrike && (
                <div className="tl-foot">
                  <StrikeButton removed={removed} onClick={() => onStrike(g.id, !removed)} />
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {replay && (
        <ReplayModal
          sessionId={sessionId}
          frames={frames}
          words={words}
          target={replay}
          expertName={expertName}
          onClose={() => setReplay(null)}
        />
      )}
    </section>
  )
}

function StrikeButton({ removed, onClick }: { removed: boolean; onClick: () => void }) {
  return (
    <button type="button" className="feed-remove tl-strike" onClick={onClick} title={removed ? 'Put back on the record' : 'Remove from the record'}>
      {removed ? 'Restore' : 'Remove'}
    </button>
  )
}

/** The session's frames and transcript, refreshed whenever the map changes (the debrief adds lines). */
function useSession(sessionId: string, map: WorkMap): Session | null {
  const [session, setSession] = useState<Session | null>(null)
  useEffect(() => {
    let cancelled = false
    api.getSession(sessionId).then((s) => !cancelled && setSession(s), () => {})
    return () => {
      cancelled = true
    }
  }, [sessionId, map])
  return session
}

/** The expert's on-record, unstruck lines. */
function expertWords(session: Session | null): Utterance[] {
  if (!session) return []
  const struck = new Set(session.struck ?? [])
  return session.transcript.filter((u) => u.speaker === 'expert' && !u.offRecord && !struck.has(u.id))
}

function nearestWords(words: Utterance[], t: number): Utterance | undefined {
  return words
    .filter((u) => Math.abs(u.t - t) <= SAID_HERE_S)
    .sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0]
}

/** A guardrail's screen moment; older maps may lack one, then the linked step's, else the frame nearest its quote. */
function guardrailMoment(g: Guardrail, steps: Step[], frames: Session['frames']): { t: number; frameId: string } {
  if (g.screenMoment?.frameId) return g.screenMoment
  const step = steps.find((s) => s.guardrailIds.includes(g.id))
  if (step) return { t: step.screenMoment.t, frameId: step.screenMoment.frameId }
  const nearest = [...frames].sort((a, b) => Math.abs(a.t - g.t) - Math.abs(b.t - g.t))[0]
  return nearest ? { t: nearest.t, frameId: nearest.id } : { t: g.t, frameId: '' }
}

/** Export without struck items (they stay out of exports, like the tutor). */
function exportJson(map: WorkMap) {
  const struck = new Set(map.struck)
  const exported: WorkMap = {
    ...map,
    steps: map.steps.filter((s) => !struck.has(s.id)).map((s) => ({ ...s, guardrailIds: s.guardrailIds.filter((g) => !struck.has(g)) })),
    guardrails: map.guardrails.filter((g) => !struck.has(g.id)),
    struck: [],
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `work-map-${map.id}-v${map.version}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Ids of steps and guardrails that changed in the latest update (they flash briefly). */
function useChangedIds(map: WorkMap): Set<string> {
  const previous = useRef<Map<string, string>>(new Map())
  const [changed, setChanged] = useState<Set<string>>(new Set())
  useEffect(() => {
    const next = new Map<string, string>()
    for (const item of [...map.steps, ...map.guardrails]) next.set(item.id, JSON.stringify(item))
    const diff = new Set<string>()
    if (previous.current.size) for (const [id, json] of next) if (previous.current.get(id) !== json) diff.add(id)
    previous.current = next
    setChanged(diff)
    if (!diff.size) return
    const timer = setTimeout(() => setChanged(new Set()), 2500)
    return () => clearTimeout(timer)
  }, [map])
  return changed
}
