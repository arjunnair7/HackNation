import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ConversationProvider, useConversation } from '@elevenlabs/react'
import type { DebugEventRequest, ScreenEventsMessage, Session, VisionErrorMessage } from '@apprentice/shared'
import { DEFAULT_DIFF_THRESHOLD } from '../capture/frameDiff.ts'
import { useScreenCapture } from '../capture/useScreenCapture.ts'
import { api } from '../lib/api.ts'
import { formatT, sessionT, useNow } from '../lib/clock.ts'
import { useLog, type LogKind } from '../lib/log.ts'
import { getSocket } from '../lib/socket.ts'
import { CapturePanel } from '../panels/CapturePanel.tsx'
import { DebugDrawer } from '../panels/DebugDrawer.tsx'
import { LiveFeed } from '../panels/LiveFeed.tsx'
import { useApprenticeClientTools } from './clientTools.ts'
import { screenCue, type CueChannel } from './cues.ts'
import '../apprentice.css'

const INTERVIEWER_AGENT_ID = import.meta.env.VITE_INTERVIEWER_AGENT_ID
const EXPERT = { name: 'Sabine', role: 'accounts payable lead' }
const TASK_NAME = 'processing supplier invoices before period close'
const FEED_KINDS = new Set<LogKind>(['expert', 'agent', 'screen', 'error'])

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

  const { entries, add } = useLog()
  const [session, setSession] = useState<Session | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const [starting, setStarting] = useState(false)
  const [lastVision, setLastVision] = useState<ScreenEventsMessage | null>(null)
  const now = useNow(1000)

  useEffect(() => {
    document.title = 'Apprentice'
  }, [])

  const tNow = () => (sessionRef.current ? sessionT(sessionRef.current.startedAtMs) : undefined)

  const conversation = useConversation({
    onConnect: () => add('info', 'Agent connected', tNow()),
    onDisconnect: (details) => add('info', `Agent disconnected (${details.reason})`, tNow()),
    onError: (message) => add('error', `Agent: ${message}`, tNow()),
    // Final transcript lines only (user_transcript / agent_response).
    onMessage: ({ message, role }) => {
      const s = sessionRef.current
      if (!s) return
      const t = sessionT(s.startedAtMs)
      add(role === 'agent' ? 'agent' : 'expert', message, t)
      api.postTranscript(s.id, { t, role, text: message }).catch((err: Error) => add('error', `Transcript not saved: ${err.message}`, t))
    },
  })
  const { status, mode, startSession, endSession, sendContextualUpdate, sendUserActivity, sendUserMessage } = conversation
  const connected = status === 'connected'
  const connectedRef = useRef(connected)
  useEffect(() => {
    connectedRef.current = connected
  }, [connected])

  useApprenticeClientTools((name, toolParams) => add('tool', `${name} ${JSON.stringify(toolParams)}`, tNow()))

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

  // Vision results → feed + contextual updates for the agent (it is told never to react to them on its own).
  useEffect(() => {
    const socket = getSocket()
    const onScreenEvents = (m: ScreenEventsMessage) => {
      if (m.sessionId !== sessionRef.current?.id) return
      setLastVision(m)
      for (const event of m.events) {
        const cue = screenCue(event)
        add('screen', cue.replace(/^\[SCREEN \d+:\d+\] /, ''), event.t)
        if (connectedRef.current) sendContextualUpdate(cue)
      }
    }
    const onVisionError = (m: VisionErrorMessage) => {
      if (m.sessionId === sessionRef.current?.id) add('error', `Vision failed on ${m.frameId}: ${m.error}`, m.t)
    }
    socket.on('screen_events', onScreenEvents)
    socket.on('vision_error', onVisionError)
    return () => {
      socket.off('screen_events', onScreenEvents)
      socket.off('vision_error', onVisionError)
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
    endSession()
    capture.stop()
    add('info', 'Session stopped', tNow())
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

      <CapturePanel
        sessionId={session?.id}
        sharing={capture.sharing}
        stream={capture.stream}
        diff={capture.diff}
        threshold={diffThreshold}
        lastChangeAt={capture.lastChangeAt}
        framesSent={capture.framesSent}
        lastVision={lastVision}
        onShare={share}
        onStopSharing={capture.stop}
      />

      <section className="appr-card">
        <h2>Live feed</h2>
        <LiveFeed
          entries={entries.filter((e) => FEED_KINDS.has(e.kind))}
          empty="Transcript and screen events appear here once the session runs."
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
