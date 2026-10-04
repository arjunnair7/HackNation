import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ConversationProvider, useConversation } from '@elevenlabs/react'
import type {
  AnswerRecordedMessage,
  DebugEventRequest,
  GuardrailKind,
  MapUpdatedMessage,
  Moment,
  MomentsUpdatedMessage,
  OpenQuestion,
  ReadyForTeachbackMessage,
  ScreenEventsMessage,
  Session,
  VisionErrorMessage,
  WorkMap,
} from '@apprentice/shared'
import { DEFAULT_DIFF_THRESHOLD } from '../capture/frameDiff.ts'
import { useScreenCapture } from '../capture/useScreenCapture.ts'
import { api } from '../lib/api.ts'
import { formatT, sessionT, useNow } from '../lib/clock.ts'
import { useLog, type LogEntry, type LogKind } from '../lib/log.ts'
import { getSocket } from '../lib/socket.ts'
import { BrainPanel } from '../panels/BrainPanel.tsx'
import { CapturePanel } from '../panels/CapturePanel.tsx'
import { DebriefPanel } from '../panels/DebriefPanel.tsx'
import { WorkMapView } from '../panels/WorkMapView.tsx'
import { DebugDrawer } from '../panels/DebugDrawer.tsx'
import { LiveFeed } from '../panels/LiveFeed.tsx'
import { useApprenticeClientTools } from './clientTools.ts'
import { debriefCue, screenCue, teachbackCue, workMapDraftCue, type CueChannel } from './cues.ts'
import { RULES } from './momentRules.ts'
import { useMomentDetector, type VoiceSignal } from './useMomentDetector.ts'
import '../apprentice.css'

const INTERVIEWER_AGENT_ID = import.meta.env.VITE_INTERVIEWER_AGENT_ID
const EXPERT = { name: 'Sabine', role: 'accounts payable lead' }
const TASK_NAME = 'processing supplier invoices before period close'
const FEED_KINDS = new Set<LogKind>(['expert', 'agent', 'screen', 'answer', 'error'])
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const OFF_RECORD_PHRASE = /\boff the record\b/i
type OffRecordSource = 'agent' | 'phrase' | 'button'
type Phase = 'capture' | 'drafting' | 'debrief'

/** Window B. The ElevenLabs provider wraps everything so any panel can reach the conversation. */
export function AgentShell() {
  return (
    <ConversationProvider>
      <ApprenticeApp />
    </ConversationProvider>
  )
}

function ApprenticeApp() {
  const [params] = useSearchParams()
  const debug = params.get('debug') === '1'
  const diffThreshold = Number(params.get('diff')) || DEFAULT_DIFF_THRESHOLD

  const { entries, add, markStruck, dropFrom } = useLog()
  const [session, setSession] = useState<Session | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const [starting, setStarting] = useState(false)
  const [lastVision, setLastVision] = useState<ScreenEventsMessage | null>(null)
  const [moments, setMoments] = useState<Moment[]>([])
  const voice = useRef<VoiceSignal>({ level: 0, lastAboveAt: 0, lastTranscriptAt: 0, seen: false })
  const [offRecord, setOffRecord] = useState<{ from: number } | null>(null)
  const offRecordRef = useRef(false)
  const goOffRecordRef = useRef<(source: OffRecordSource) => void>(() => {})
  const [phase, setPhase] = useState<Phase>('capture')
  const phaseRef = useRef<Phase>('capture')
  phaseRef.current = phase
  const [map, setMap] = useState<WorkMap | null>(null)
  const compactRef = useRef('')
  const teachbackSent = useRef(false)
  const now = useNow(1000)

  useEffect(() => {
    document.title = 'Apprentice'
  }, [])

  const tNow = () => (sessionRef.current ? sessionT(sessionRef.current.startedAtMs) : undefined)

  const conversation = useConversation({
    onConnect: () => add('info', 'Agent connected', tNow()),
    onDisconnect: (details) => add('info', `Agent disconnected (${details.reason})`, tNow()),
    onError: (message) => add('error', `Agent: ${message}`, tNow()),
    // Q1 "is the expert talking?" (needs vad_score in the agent's client_events).
    onVadScore: ({ vadScore }) => {
      voice.current.level = vadScore
      voice.current.seen = true
      if (vadScore > RULES.vadThreshold) voice.current.lastAboveAt = Date.now()
    },
    // Final transcript lines only (user_transcript / agent_response).
    onMessage: ({ message, role }) => {
      const s = sessionRef.current
      if (!s) return
      const t = sessionT(s.startedAtMs)
      if (role === 'user') {
        voice.current.lastAboveAt = Date.now() // fallback if VAD never arrives
        voice.current.lastTranscriptAt = Date.now()
      }
      // Off the record: nothing is captured, not even the agent's "Okay, off the record."
      if (offRecordRef.current) return
      if (role === 'user' && OFF_RECORD_PHRASE.test(message)) {
        goOffRecordRef.current('phrase') // don't wait for the agent's tool call; this line is never stored
        return
      }
      // The feed shows what was stored (redacted), not the raw line.
      api
        .postTranscript(s.id, { t, role, text: message })
        .then((u) => add(role === 'agent' ? 'agent' : 'expert', u.text, t, role === 'user' ? u.id : undefined))
        .catch((err: Error) => add('error', `Transcript not saved: ${err.message}`, t))
    },
  })
  const { status, mode, startSession, endSession, sendContextualUpdate, sendUserActivity, sendUserMessage, setMuted } =
    conversation
  // setMuted throws when no conversation is active (before Start, after a disconnect): then there is no mic to mute.
  const muteMic = (muted: boolean) => {
    try {
      setMuted(muted)
    } catch {
      /* no active conversation */
    }
  }
  const connected = status === 'connected'
  const connectedRef = useRef(connected)
  useEffect(() => {
    connectedRef.current = connected
  }, [connected])

  const capture = useScreenCapture({
    threshold: diffThreshold,
    // Keeps the agent from taking a turn while the screen is moving.
    onActivity: () => {
      if (connectedRef.current) sendUserActivity()
    },
    onFrame: ({ jpegBase64, capturedAt }) => {
      const s = sessionRef.current
      if (!s) return
      const t = sessionT(s.startedAtMs, capturedAt)
      api.postFrame(s.id, { t, jpegBase64 }).catch((err: Error) => add('error', `Frame not sent: ${err.message}`, t))
    },
  })

  const detector = useMomentDetector({
    sessionId: session?.id,
    enabled: phase === 'capture',
    expertName: EXPERT.name,
    connected,
    agentSpeaking: mode === 'speaking',
    offRecord: offRecord !== null,
    moments,
    lastScreenChangeAt: capture.lastScreenChangeAt,
    voice,
    sendUserMessage,
    onAsk: (cue) => add('cue', cue, tNow()),
    onAwaitTimeout: () => add('info', 'No answer recorded within 30 s; those moments go to the debrief', tNow()),
  })

  useApprenticeClientTools(
    {
      record_answer: (p) => {
        const s = sessionRef.current
        if (!s) return
        if (phaseRef.current === 'debrief') {
          // An open-question answer: the server quotes the transcript and folds it into the map.
          api
            .mapAnswer(s.id, { questionId: String(p.moment_id ?? ''), reasonQuote: str(p.reason_quote) })
            .catch((err: Error) => add('info', `Debrief answer not applied: ${err.message}`, tNow()))
          return
        }
        if (!detector.acceptAnswer()) {
          add('info', `Ignored record_answer before ${EXPERT.name} answered (agent jumped ahead)`, tNow())
          return
        }
        api
          .recordAnswer(s.id, {
            momentId: String(p.moment_id ?? ''),
            reasonQuote: String(p.reason_quote ?? ''),
            decisionSummary: str(p.decision_summary),
            guardrailText: str(p.guardrail_text),
            guardrailKind: str(p.guardrail_kind) as GuardrailKind | undefined,
          })
          .catch((err: Error) => add('error', `Answer not saved: ${err.message}`, tNow()))
      },
      go_off_record: () => goOffRecordRef.current('agent'),
      submit_correction: (p) => {
        const s = sessionRef.current
        if (!s) return
        api
          .mapCorrection(s.id, { correction: String(p.correction ?? '') })
          .catch((err: Error) => add('error', `Correction not applied: ${err.message}`, tNow()))
      },
      confirm_teachback: () => {
        const s = sessionRef.current
        if (!s) return
        api.mapConfirm(s.id).catch((err: Error) => add('error', `Confirmation not saved: ${err.message}`, tNow()))
      },
    },
    (name, toolParams) => add('tool', `${name} ${JSON.stringify(toolParams)}`, tNow()),
  )

  // Vision results → feed + contextual updates for the agent (it is told never to react to them on its own).
  useEffect(() => {
    const socket = getSocket()
    const onScreenEvents = (m: ScreenEventsMessage) => {
      if (m.sessionId !== sessionRef.current?.id) return
      setLastVision(m)
      for (const event of m.events) {
        const cue = screenCue(event)
        add('screen', cue.replace(/^\[SCREEN \d+:\d+\] /, ''), event.t, event.id)
        if (connectedRef.current && !offRecordRef.current) sendContextualUpdate(cue)
      }
    }
    const onVisionError = (m: VisionErrorMessage) => {
      if (m.sessionId === sessionRef.current?.id) add('error', `Vision failed on ${m.frameId}: ${m.error}`, m.t)
    }
    const onMoments = (m: MomentsUpdatedMessage) => {
      if (m.sessionId === sessionRef.current?.id) setMoments(m.moments)
    }
    const onAnswer = (m: AnswerRecordedMessage) => {
      if (m.sessionId !== sessionRef.current?.id) return
      add('answer', `"${m.answer.quote}"${m.answer.guardrailText ? ` · guardrail: ${m.answer.guardrailText}` : ''}`, m.answer.t, m.answer.id)
    }
    socket.on('screen_events', onScreenEvents)
    socket.on('vision_error', onVisionError)
    const onMap = (m: MapUpdatedMessage) => {
      if (m.sessionId !== sessionRef.current?.id) return
      setMap(m.map)
      compactRef.current = m.compact
    }
    const onReady = (m: ReadyForTeachbackMessage) => {
      if (m.sessionId !== sessionRef.current?.id || teachbackSent.current) return
      compactRef.current = m.compact
      startTeachbackRef.current()
    }
    socket.on('moments_updated', onMoments)
    socket.on('answer_recorded', onAnswer)
    socket.on('map_updated', onMap)
    socket.on('ready_for_teachback', onReady)
    return () => {
      socket.off('map_updated', onMap)
      socket.off('ready_for_teachback', onReady)
      socket.off('screen_events', onScreenEvents)
      socket.off('vision_error', onVisionError)
      socket.off('moments_updated', onMoments)
      socket.off('answer_recorded', onAnswer)
    }
  }, [add, sendContextualUpdate])

  const start = async () => {
    if (!INTERVIEWER_AGENT_ID) {
      add('error', 'VITE_INTERVIEWER_AGENT_ID is missing: run scripts/setup-agents.ts, then restart npm run dev.')
      return
    }
    setStarting(true)
    try {
      // Ask for the mic up front so the permission prompt doesn't race the agent's first message.
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
      mic.getTracks().forEach((track) => track.stop())
      const s = await api.createSession({ mode: 'capture', expert: EXPERT })
      sessionRef.current = s
      setSession(s)
      setLastVision(null)
      setMoments([])
      detector.reset()
      offRecordRef.current = false
      setOffRecord(null)
      setPhase('capture')
      setMap(null)
      teachbackSent.current = false
      add('info', `Session ${s.id} started`, 0)
      startSession({
        agentId: INTERVIEWER_AGENT_ID,
        connectionType: 'webrtc',
        dynamicVariables: { expert_name: EXPERT.name, expert_role: EXPERT.role, task_name: TASK_NAME },
      })
    } catch (err) {
      add('error', `Could not start: ${(err as Error).message}`)
    } finally {
      setStarting(false)
    }
  }

  const stop = () => {
    if (offRecordRef.current) {
      const s = sessionRef.current
      if (s) api.offRecord(s.id, { to: sessionT(s.startedAtMs) }).catch(() => {})
      offRecordRef.current = false
      setOffRecord(null)
      muteMic(false)
    }
    endSession()
    capture.stop()
    add('info', 'Session stopped', tNow())
  }

  /**
   * Q5 trust. Mutes the mic, pauses capture, and opens an off-record window on the server, which purges
   * everything captured from `from` on. When the agent or the phrase triggers it, the window starts at
   * the expert's last line (usually the "off the record" sentence itself).
   */
  const goOffRecord = (source: OffRecordSource) => {
    const s = sessionRef.current
    if (!s || offRecordRef.current) return
    offRecordRef.current = true
    const nowT = sessionT(s.startedAtMs)
    const lastLineAgo = (Date.now() - voice.current.lastTranscriptAt) / 1000
    const from = Math.max(0, source !== 'button' && lastLineAgo <= 15 ? nowT - lastLineAgo - 0.5 : nowT)
    capture.pause()
    api.offRecord(s.id, { from }).catch((err: Error) => add('error', `Off-record window not saved: ${err.message}`, nowT))
    dropFrom(from)
    setOffRecord({ from })
    muteMic(true)
    add('info', `Off the record from ${formatT(from)} (${source === 'agent' ? 'agent heard it' : source === 'phrase' ? 'heard "off the record"' : 'button'})`, from)
  }
  goOffRecordRef.current = goOffRecord

  const resume = () => {
    const s = sessionRef.current
    if (!s || !offRecordRef.current) return
    const to = sessionT(s.startedAtMs)
    offRecordRef.current = false
    setOffRecord(null)
    muteMic(false)
    if (connectedRef.current) sendContextualUpdate('[BACK_ON_RECORD]')
    add('info', `Back on the record at ${formatT(to)}`, to)
    // Close the window before the first new frame goes out, or the server would drop it.
    api
      .offRecord(s.id, { to })
      .then(() => capture.resume())
      .catch((err: Error) => add('error', `Could not go back on the record: ${err.message}`, to))
  }

  /** Phase 6: stop capturing, build the Work Map, then the agent debriefs the open questions. */
  const doneWithTask = async () => {
    const s = sessionRef.current
    if (!s) return
    capture.stop()
    setPhase('drafting')
    add('info', 'Capture finished: building the Work Map', tNow())
    try {
      const { map: draft, compact } = await api.mapDraft(s.id)
      setMap(draft)
      compactRef.current = compact
      setPhase('debrief')
      add('info', `Work Map drafted: ${draft.steps.length} steps, ${draft.guardrails.length} guardrails, ${draft.openQuestions.length} open questions`, tNow())
      if (!connectedRef.current) {
        add('info', 'Agent not connected: answer or skip the questions in the panel', tNow())
        return
      }
      sendContextualUpdate(workMapDraftCue(compact))
      const cue = debriefCue(draft, EXPERT.name)
      sendUserMessage(cue)
      add('cue', cue, tNow())
    } catch (err) {
      setPhase('capture')
      add('error', `Work Map not built: ${(err as Error).message}`, tNow())
    }
  }

  const startTeachback = () => {
    teachbackSent.current = true
    if (!connectedRef.current) {
      add('info', 'Agent not connected: no teach-back', tNow())
      return
    }
    const cue = teachbackCue(compactRef.current, EXPERT.name)
    sendUserMessage(cue)
    add('cue', cue, tNow())
  }
  const startTeachbackRef = useRef(startTeachback)
  startTeachbackRef.current = startTeachback

  const strikeMapItem = (id: string, struck: boolean) => {
    const s = sessionRef.current
    if (!s) return
    api.mapStrike(s.id, { id, struck }).catch((err: Error) => add('error', `Could not ${struck ? 'remove' : 'restore'}: ${err.message}`, tNow()))
  }

  const skipQuestion = (q: OpenQuestion) => {
    const s = sessionRef.current
    if (!s) return
    api.mapAnswer(s.id, { questionId: q.id, skip: true }).catch((err: Error) => add('error', `Skip failed: ${err.message}`, tNow()))
  }

  const strike = (entry: LogEntry) => {
    const s = sessionRef.current
    if (!s || !entry.ref) return
    const id = entry.ref
    api
      .strike(s.id, { id })
      .then(() => markStruck(id))
      .catch((err: Error) => add('error', `Could not remove: ${err.message}`, tNow()))
  }

  const share = () => {
    capture
      .start()
      .then(() => add('info', 'Screen sharing started', tNow()))
      .catch((err: Error) => add('error', `Screen sharing not started: ${err.message}`, tNow()))
  }

  const sendCue = useCallback(
    (text: string, channel: CueChannel) => {
      if (channel === 'message') sendUserMessage(text)
      else sendContextualUpdate(text)
      add('cue', `${channel === 'message' ? 'message' : 'context'}: ${text}`, tNow())
    },
    [add, sendContextualUpdate, sendUserMessage],
  )

  const injectEvent = (event: DebugEventRequest) => {
    const s = sessionRef.current
    if (!s) return
    api.injectEvent(s.id, event).catch((err: Error) => add('error', `Inject failed: ${err.message}`, tNow()))
  }

  const live = connected || status === 'connecting'

  return (
    <div className="appr">
      <header className="appr-head">
        <div>
          <h1>Apprentice</h1>
          <div className="appr-sub">
            Shadowing {EXPERT.name} · {session ? `${session.id} · ${formatT(sessionT(session.startedAtMs, now))}` : 'no session'}
          </div>
        </div>
        <div className="appr-head-right">
          <span className={`status status-${status}`}>
            {status === 'connected' ? (mode === 'speaking' ? 'Speaking' : 'Listening') : status}
          </span>
          {session && phase === 'capture' && !offRecord && (
            <button type="button" className="appr-btn" onClick={() => void doneWithTask()}>
              Done with task
            </button>
          )}
          {phase === 'drafting' && <span className="appr-small">Building the Work Map…</span>}
          {session && !offRecord && (
            <button type="button" className="appr-btn appr-btn-danger" onClick={() => goOffRecord('button')}>
              Off the record
            </button>
          )}
          {live ? (
            <button type="button" className="appr-btn" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="button" className="appr-btn appr-btn-primary" onClick={() => void start()} disabled={starting}>
              {starting ? 'Starting…' : 'Start'}
            </button>
          )}
        </div>
      </header>

      {!INTERVIEWER_AGENT_ID && (
        <div className="appr-alert">
          VITE_INTERVIEWER_AGENT_ID is missing. Run <code>npx tsx scripts/setup-agents.ts</code> in apps/api, then restart{' '}
          <code>npm run dev</code>.
        </div>
      )}

      {offRecord && (
        <div className="off-record" role="alert">
          <div>
            <strong>Off the record. Nothing is captured.</strong>
            <span>
              Mic muted, screen capture paused, everything since {formatT(offRecord.from)} dropped.
            </span>
          </div>
          <button type="button" className="appr-btn appr-btn-primary" onClick={resume}>
            Resume
          </button>
        </div>
      )}

      {map && phase === 'debrief' && (
        <DebriefPanel map={map} expertName={EXPERT.name} onSkip={skipQuestion} onStartTeachback={startTeachback} />
      )}

      {map && session && phase === 'debrief' && (
        <WorkMapView sessionId={session.id} map={map} expertName={EXPERT.name} onStrike={strikeMapItem} showOpenLink />
      )}

      {phase === 'capture' && <BrainPanel brain={detector.brain} moments={moments} expertName={EXPERT.name} />}

      {phase === 'capture' && (
        <CapturePanel
        sessionId={session?.id}
        sharing={capture.sharing}
        stream={capture.stream}
        diff={capture.diff}
        threshold={diffThreshold}
        lastChangeAt={capture.lastChangeAt}
        framesSent={capture.framesSent}
        paused={capture.paused}
        lastVision={lastVision}
        onShare={share}
        onStopSharing={capture.stop}
        />
      )}

      <section className="appr-card">
        <h2>Live feed</h2>
        <LiveFeed
          entries={entries.filter((e) => FEED_KINDS.has(e.kind))}
          empty="Transcript and screen events appear here once the session runs."
          onStrike={session ? strike : undefined}
        />
      </section>

      {debug && (
        <DebugDrawer
          connected={connected}
          hasSession={session !== null}
          entries={entries}
          onSendCue={sendCue}
          onInjectEvent={injectEvent}
        />
      )}
    </div>
  )
}
