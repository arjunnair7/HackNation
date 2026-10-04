import { useEffect, useMemo, useState } from 'react'
import type { FrameRef, Utterance } from '@apprentice/shared'
import { api } from '../lib/api.ts'
import { formatT } from '../lib/clock.ts'

export interface ReplayTarget {
  kind: string // "Step 2/5" or "Guardrail · Limit"
  title: string
  moment: { t: number; frameId: string }
  quote?: { text: string; label: string } // e.g. label "live question at 03:15"
}

interface Props {
  sessionId: string
  frames: FrameRef[]
  words: Utterance[] // the expert's on-record lines
  target: ReplayTarget
  expertName: string
  onClose: () => void
}

const WINDOW_S = 5 // prev/next step through the frames ±5 s around the moment
const WORDS_S = 10

/** The stored frame at the moment, the expert's words and the time; ←/→ step through nearby frames, Esc closes. */
export function ReplayModal({ sessionId, frames, words, target, expertName, onClose }: Props) {
  const nearby = useMemo(
    () => frames.filter((f) => Math.abs(f.t - target.moment.t) <= WINDOW_S || f.id === target.moment.frameId).sort((a, b) => a.t - b.t),
    [frames, target],
  )
  const startIndex = Math.max(0, nearby.findIndex((f) => f.id === target.moment.frameId))
  const [index, setIndex] = useState(startIndex)
  const frame = nearby[index]
  const around = words.filter((u) => Math.abs(u.t - target.moment.t) <= WORDS_S)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(nearby.length - 1, i + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nearby.length, onClose])

  return (
    <div className="replay-backdrop" role="dialog" aria-modal="true" aria-label={`Replay: ${target.title}`} onClick={onClose}>
      <div className="replay" onClick={(e) => e.stopPropagation()}>
        <div className="replay-head">
          <div>
            <span className="signal-label">{target.kind}</span>
            <h3>{target.title}</h3>
          </div>
          <button type="button" className="appr-btn appr-btn-small" onClick={onClose} aria-label="Close replay">
            Close
          </button>
        </div>

        {frame ? (
          <img className="replay-frame" src={api.frameUrl(sessionId, frame.id)} alt={`Screen at ${formatT(frame.t)}`} />
        ) : (
          <div className="replay-frame replay-missing">No stored frame for this moment</div>
        )}

        <div className="replay-nav">
          <button type="button" className="appr-btn appr-btn-small" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
            ← Prev
          </button>
          <span className="replay-time">
            {frame ? formatT(frame.t) : formatT(target.moment.t)}
            {nearby.length > 1 && ` · frame ${index + 1}/${nearby.length}`}
            {frame && frame.id === target.moment.frameId && ' · the moment'}
          </span>
          <button
            type="button"
            className="appr-btn appr-btn-small"
            disabled={index >= nearby.length - 1}
            onClick={() => setIndex((i) => i + 1)}
          >
            Next →
          </button>
        </div>

        {target.quote && (
          <blockquote className="replay-quote">
            "{target.quote.text}"<cite>{expertName}, {target.quote.label}</cite>
          </blockquote>
        )}

        <div className="replay-words">
          <span className="signal-label">What {expertName} said around {formatT(target.moment.t)}</span>
          {around.length ? (
            around.map((u) => (
              <div key={u.id} className="replay-word">
                <span className="feed-time">{formatT(u.t)}</span> {u.text}
              </div>
            ))
          ) : (
            <p className="appr-muted">Nothing said within {WORDS_S} s of this moment.</p>
          )}
        </div>
      </div>
    </div>
  )
}
