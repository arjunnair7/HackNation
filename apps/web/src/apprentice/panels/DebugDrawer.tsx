import { useState } from 'react'
import type { DebugEventRequest, ScreenEvent } from '@apprentice/shared'
import { CUE_PRESETS, type CueChannel } from '../agent/cues.ts'
import type { LogEntry } from '../lib/log.ts'
import { LiveFeed } from './LiveFeed.tsx'

const KINDS: ScreenEvent['kind'][] = ['opened', 'navigated', 'field_changed', 'action', 'lookup', 'typed', 'read', 'other']

interface Props {
  connected: boolean
  hasSession: boolean
  entries: LogEntry[]
  onSendCue: (text: string, channel: CueChannel) => void
  onInjectEvent: (event: DebugEventRequest) => void
}

/** /apprentice?debug=1: send any cue, inject a fake screen event, see the full log. */
export function DebugDrawer({ connected, hasSession, entries, onSendCue, onInjectEvent }: Props) {
  const [cue, setCue] = useState(CUE_PRESETS[0].text)
  const [channel, setChannel] = useState<CueChannel>(CUE_PRESETS[0].channel)
  const [event, setEvent] = useState<DebugEventRequest>({
    kind: 'field_changed',
    entity: 'INV-4471',
    field: 'cost center',
    from: '4711',
    to: '0400',
    description: 'Cost center on INV-4471 changed 4711 → 0400 (Maintenance → Capital Equipment)',
  })
  const set = (patch: Partial<DebugEventRequest>) => setEvent((e) => ({ ...e, ...patch }))

  return (
    <details className="appr-card debug" open>
      <summary>Debug</summary>

      <h3>Send a cue</h3>
      <div className="debug-presets">
        {CUE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="appr-btn appr-btn-small"
            onClick={() => {
              setCue(p.text)
              setChannel(p.channel)
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <textarea className="appr-input" rows={3} value={cue} onChange={(e) => setCue(e.target.value)} />
      <div className="debug-row">
        <label>
          <input type="radio" checked={channel === 'message'} onChange={() => setChannel('message')} /> sendUserMessage
        </label>
        <label>
          <input type="radio" checked={channel === 'context'} onChange={() => setChannel('context')} /> sendContextualUpdate
        </label>
        <button type="button" className="appr-btn appr-btn-primary" disabled={!connected || !cue.trim()} onClick={() => onSendCue(cue, channel)}>
          Send
        </button>
      </div>

      <h3>Inject a screen event</h3>
      <div className="debug-form">
        <select className="appr-input" value={event.kind} onChange={(e) => set({ kind: e.target.value as ScreenEvent['kind'] })}>
          {KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <input className="appr-input" placeholder="entity" value={event.entity ?? ''} onChange={(e) => set({ entity: e.target.value })} />
        <input className="appr-input" placeholder="field" value={event.field ?? ''} onChange={(e) => set({ field: e.target.value })} />
        <input className="appr-input" placeholder="from" value={event.from ?? ''} onChange={(e) => set({ from: e.target.value })} />
        <input className="appr-input" placeholder="to" value={event.to ?? ''} onChange={(e) => set({ to: e.target.value })} />
      </div>
      <div className="debug-row">
        <input
          className="appr-input debug-grow"
          placeholder="description"
          value={event.description}
          onChange={(e) => set({ description: e.target.value })}
        />
        <button type="button" className="appr-btn" disabled={!hasSession || !event.description.trim()} onClick={() => onInjectEvent(event)}>
          Inject
        </button>
      </div>

      <h3>Full log</h3>
      <LiveFeed entries={entries} />
    </details>
  )
}
