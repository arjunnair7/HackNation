import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { Moment } from '@apprentice/shared'
import { api } from '../lib/api.ts'
import { askNowCue, askNowReminder } from './cues.ts'
import { decide, RULES, type Decision } from './momentRules.ts'

/** Updated from onVadScore (and final user transcripts as a fallback). */
export interface VoiceSignal {
  level: number
  lastAboveAt: number
  lastTranscriptAt: number // last final expert transcript line
  seen: boolean // any vad_score event yet? (they need client_events, see setup-agents.ts)
}

export interface MomentDetectorOptions {
  sessionId?: string
  enabled: boolean // only during capture
  expertName: string
  connected: boolean
  agentSpeaking: boolean
  offRecord: boolean
  moments: Moment[]
  lastScreenChangeAt: RefObject<number>
  voice: RefObject<VoiceSignal>
  sendUserMessage: (text: string) => void
  onAsk?: (cue: string) => void
  onAwaitTimeout?: () => void
}

export interface BrainState extends Decision {
  agentSpeaking: boolean
  awaitingAnswer: boolean
  askedCount: number
  screenLevel: number // 1 = just changed, fades to 0 over the busy window
  vadLevel: number
  vadSeen: boolean
}

/** Ticks every 250 ms; when every gate is open it sends [ASK_NOW] with up to 3 candidates. */
export function useMomentDetector(options: MomentDetectorOptions) {
  const opts = useRef(options)
  useEffect(() => {
    opts.current = options
  })
  const asked = useRef({ count: 0, lastAt: 0 })
  const awaiting = useRef<{ since: number; candidates: Moment[]; spoke: boolean; spokeAt: number; reminded: boolean } | null>(null)
  const [brain, setBrain] = useState<BrainState | null>(null)

  useEffect(() => {
    const timer = setInterval(() => {
      const o = opts.current
      const now = Date.now()
      if (!o.enabled) {
        awaiting.current = null
        return
      }

      const lastScreenChangeAt = o.lastScreenChangeAt.current ?? 0
      const voice = o.voice.current ?? { level: 0, lastAboveAt: 0, seen: false }
      const pending = awaiting.current

      if (pending && o.agentSpeaking && !pending.spoke) {
        pending.spoke = true
        pending.spokeAt = now
      }
      if (pending && now - pending.since > RULES.awaitAnswerMs) {
        // No record_answer in time: don't offer these again, they go to the debrief.
        awaiting.current = null
        const ids = pending.candidates.map((c) => c.id)
        if (o.sessionId) api.setMomentStatus(o.sessionId, { ids, status: 'expired' }).catch(() => {})
        o.onAwaitTimeout?.()
      } else if (
        pending && !pending.spoke && !pending.reminded && now - pending.since > RULES.reminderAfterMs &&
        now - voice.lastAboveAt > RULES.talkingWindowMs && now - lastScreenChangeAt > RULES.screenBusyMs
      ) {
        // The agent skipped the cue although nothing changed: nudge once.
        pending.reminded = true
        const reminder = askNowReminder(pending.candidates, o.expertName)
        o.sendUserMessage(reminder)
        o.onAsk?.(reminder)
      }
      const d = decide({
        now,
        expertName: o.expertName,
        connected: o.connected,
        agentSpeaking: o.agentSpeaking,
        awaitingAnswer: awaiting.current !== null,
        offRecord: o.offRecord,
        lastScreenChangeAt,
        lastVoiceAt: voice.lastAboveAt,
        askedCount: asked.current.count,
        lastQuestionAt: asked.current.lastAt,
        moments: o.moments,
      })

      if (d.ask && o.sessionId) {
        const cue = askNowCue(d.candidates, o.expertName)
        const ids = d.candidates.map((c) => c.id)
        o.sendUserMessage(cue)
        asked.current = { count: asked.current.count + 1, lastAt: now }
        awaiting.current = { since: now, candidates: d.candidates, spoke: false, spokeAt: 0, reminded: false }
        api.setMomentStatus(o.sessionId, { ids, status: 'offered' }).catch(() => {})
        o.onAsk?.(cue)
      }

      setBrain({
        ...d,
        agentSpeaking: o.agentSpeaking,
        awaitingAnswer: awaiting.current !== null,
        agentBusy: o.agentSpeaking || awaiting.current !== null,
        askedCount: asked.current.count,
        screenLevel: Math.max(0, 1 - (now - lastScreenChangeAt) / RULES.screenBusyMs),
        vadLevel: voice.level,
        vadSeen: voice.seen,
      })
    }, RULES.tickMs)
    return () => clearInterval(timer)
  }, [])

  /**
   * record_answer arrived. While an [ASK_NOW] is pending it only counts once the agent has spoken and the
   * expert has replied since (the agent sometimes calls it before asking, with an invented answer).
   * Returns false for such premature calls; the cue stays pending.
   */
  const acceptAnswer = useCallback((): boolean => {
    const pending = awaiting.current
    const lastTranscriptAt = opts.current.voice.current?.lastTranscriptAt ?? 0
    if (pending && !(pending.spoke && lastTranscriptAt > pending.spokeAt)) return false
    awaiting.current = null
    return true
  }, [])

  /** New session: fresh budget. */
  const reset = useCallback(() => {
    asked.current = { count: 0, lastAt: 0 }
    awaiting.current = null
  }, [])

  return { brain, acceptAnswer, reset }
}
