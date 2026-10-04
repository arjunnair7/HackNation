import { useEffect, useRef } from 'react'
import { formatT } from '../lib/clock.ts'
import type { LogEntry, LogKind } from '../lib/log.ts'

const LABEL: Record<LogKind, string> = {
  expert: 'Expert',
  agent: 'Apprentice',
  screen: 'Screen',
  answer: 'Answer',
  cue: 'Cue',
  tool: 'Tool',
  info: 'Info',
  error: 'Error',
}

/** Scrolling log, newest at the bottom. */
export function LiveFeed({
  entries,
  empty = 'Nothing yet.',
  onStrike,
}: {
  entries: LogEntry[]
  empty?: string
  onStrike?: (entry: LogEntry) => void
}) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [entries.length])

  if (entries.length === 0) return <p className="appr-muted">{empty}</p>
  return (
    <div className="feed" role="log" aria-live="polite">
      {entries.map((e) => (
        <div key={e.id} className={`feed-row feed-${e.kind}${e.struck ? ' feed-struck' : ''}`}>
          <span className="feed-time">{e.t === undefined ? '' : formatT(e.t)}</span>
          <span className="feed-kind">{LABEL[e.kind]}</span>
          <span className="feed-text">{e.text}</span>
          {onStrike && e.ref && (
            <span className="feed-action">
              {e.struck ? (
                'removed'
              ) : (
                <button type="button" className="feed-remove" title="Remove from the record" onClick={() => onStrike(e)}>
                  Remove
                </button>
              )}
            </span>
          )}
        </div>
      ))}
      <div ref={end} />
    </div>
  )
}
