import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useConversation } from '@elevenlabs/react'
import type {
  GuardrailAlertMessage,
  GuardrailResolvedMessage,
  MapSummary,
  MasteryRecord,
  MasteryUpdatedMessage,
  ScreenEventsMessage,
  Session,
  TeachCueMessage,
  TeachInvoiceMessage,
  TutorMapResponse,
  VisionErrorMessage,
} from '@apprentice/shared'
import { DEFAULT_DIFF_THRESHOLD } from '../capture/frameDiff.ts'
import { useScreenCapture } from '../capture/useScreenCapture.ts'
import { api } from '../lib/api.ts'
import { formatT, sessionT, useNow } from '../lib/clock.ts'
import { erpOrbMasks, openErpWindow, useErpWindow } from '../lib/erpLayout.ts'
import { useLog, type LogKind } from '../lib/log.ts'
import { expertWords, guardrailReplay, stepReplay } from '../lib/mapReplay.ts'
import { getSocket } from '../lib/socket.ts'
import { CapturePanel } from '../panels/CapturePanel.tsx'
import { LiveFeed } from '../panels/LiveFeed.tsx'
import { MasteryReport } from '../panels/MasteryReport.tsx'
import { ReplayModal, type ReplayTarget } from '../panels/ReplayModal.tsx'
import { TutorPanel, type TutorAlert, type TutorCueState } from '../panels/TutorPanel.tsx'
import { useApprenticeClientTools } from './clientTools.ts'
import { screenCue } from './cues.ts'
import { GetReady } from './GetReady.tsx'
import { PresenceOrb } from './PresenceOrb.tsx'
import { RULES } from './momentRules.ts'
import type { VoiceSignal } from './useMomentDetector.ts'

const TUTOR_AGENT_ID = import.meta.env.VITE_TUTOR_AGENT_ID
const TRAINEE = { name: 'Lena' }
const FEED_KINDS = new Set<LogKind>(['expert', 'agent', 'screen', 'error'])
const CUE_QUIET_SCREEN_MS = 1000
const CUE_EXPIRES_MS = 25_000

/** Phase 8, window B in teach mode: the tutor coaches the trainee on cases the expert never showed. */
export function TeachApp() {
  const [params] = useSearchParams()
  const diffThreshold = Number(params.get('diff')) || DEFAULT_DIFF_THRESHOLD
  const debug = params.get('debug') === '1'
  const { entries, add } = useLog()
  const now = useNow(1000)
  const erpOpen = useErpWindow()

  const [maps, setMaps] = useState<MapSummary[]>([])
  const [mapId, setMapId] = useState(params.get('map') ?? '')
  const [tutor, setTutor] = useState<TutorMapResponse | null>(null)
  const [expertSession, setExpertSession] = useState<Session | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const [starting, setStarting] = useState(false)
  const [ended, setEnded] = useState(false)
  const [invoice, setInvoice] = useState<{ id: string; label: string } | null>(null)
  const invoiceRef = useRef<string | undefined>(undefined)
  const [cue, setCue] = useState<TutorCueState | null>(null)
  const cueRef = useRef<(TutorCueState & { at: number }) | null>(null)
  const [alerts, setAlerts] = useState<TutorAlert[]>([])
  const alertId = useRef(0)
  const [mastery, setMastery] = useState<MasteryRecord[]>([])
  const [replay, setReplay] = useState<ReplayTarget | null>(null)
  const [showReport, setShowReport] = useState(false)
  const voice = useRef<VoiceSignal>({ level: 0, lastAboveAt: 0, lastTranscriptAt: 0, seen: false })

  useEffect(() => {
    document.title = 'Apprentice · Teach'
    api.listMaps().then((list) => {
      setMaps(list)
      setMapId((current) => current || list.find((m) => m.teachback === 'confirmed')?.id || list[0]?.id || '')
    }, (err: Error) => add('error', `Could not list Work Maps: ${err.message}`))
  }, [add])

  const tNow = () => (sessionRef.current ? sessionT(sessionRef.current.startedAtMs) : undefined)
  const expert = tutor?.map.expert ?? { name: 'Sabine', role: 'accounts payable lead' }

  const conversation = useConversation({
    onConnect: () => add('info', 'Tutor connected', tNow()),
    onDisconnect: (details) => add('info', `Tutor disconnected (${details.reason})`, tNow()),
    onError: (message) => add('error', `Tutor: ${message}`, tNow()),
    onVadScore: ({ vadScore }) => {
      voice.current.level = vadScore
      voice.current.seen = true
      if (vadScore > RULES.vadThreshold) voice.current.lastAboveAt = Date.now()
    },
    onMessage: ({ message, role }) => {
      const s = sessionRef.current
      if (!s) return
      const t = sessionT(s.startedAtMs)
      if (role === 'user') {
        voice.current.lastAboveAt = Date.now()
        voice.current.lastTranscriptAt = Date.now()
      }
      api
        .postTranscript(s.id, { t, role, text: message })
        .then((u) => add(role === 'agent' ? 'agent' : 'expert', u.text, t, role === 'user' ? u.id : undefined))
        .catch((err: Error) => add('error', `Transcript not saved: ${err.message}`, t))
    },
  })
  const { status, mode, startSession, endSession, sendContextualUpdate, sendUserActivity, sendUserMessage } = conversation
  const connected = status === 'connected'
  const connectedRef = useRef(connected)
  connectedRef.current = connected
  const modeRef = useRef(mode)
  modeRef.current = mode

  const capture = useScreenCapture({
    threshold: diffThreshold,
    mask: erpOrbMasks, // the ERP's mirror of our orb moves constantly; vision never sees it
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

  const sendCue = (text: string) => {
    if (!connectedRef.current) {
      add('info', 'Tutor not connected: cue not sent', tNow())
      return false
    }
    sendUserMessage(text)
    add('cue', text, tNow())
    return true
  }

  const openStep = (id: string) => {
    if (!tutor) return
    const step = tutor.map.steps.find((s) => s.id === id)
    const guardrail = tutor.map.guardrails.find((g) => g.id === id)
    if (step) setReplay(stepReplay(tutor.map, step, expertSession))
    else if (guardrail) setReplay(guardrailReplay(tutor.map, guardrail, expertSession))
  }

  useApprenticeClientTools(
    {
      record_prediction: (p) => {
        const s = sessionRef.current
        if (!s) return
        api
          .recordPrediction(s.id, {
            stepId: String(p.step_id ?? ''),
            correct: p.correct === true || p.correct === 'true',
            traineeAnswer: typeof p.trainee_answer === 'string' ? p.trainee_answer : undefined,
            invoiceId: invoiceRef.current,
          })
          .catch((err: Error) => add('error', `Prediction not saved: ${err.message}`, tNow()))
      },
      replay_expert_moment: (p) => openStep(String(p.step_id ?? '')),
      show_mastery_report: () => setShowReport(true),
    },
    (name, toolParams) => add('tool', `${name} ${JSON.stringify(toolParams)}`, tNow()),
  )

  // Server → tutor: invoice opened, cues, guardrail alerts, mastery; screen events become context.
  useEffect(() => {
    const socket = getSocket()
    const mine = (m: { sessionId: string }) => m.sessionId === sessionRef.current?.id
    const pushAlert = (kind: TutorAlert['kind'], invoiceId: string, guardrailId: string) =>
      setAlerts((a) => [...a, { id: alertId.current++, kind, invoiceId, guardrailId, t: tNow() }])

    const onScreen = (m: ScreenEventsMessage) => {
      if (!mine(m)) return
      for (const e of m.events) {
        const text = screenCue(e)
        add('screen', text.replace(/^\[SCREEN \d+:\d+\] /, ''), e.t, e.id)
        if (connectedRef.current) sendContextualUpdate(text)
      }
    }
    const onVisionError = (m: VisionErrorMessage) => mine(m) && add('error', `Vision failed on ${m.frameId}: ${m.error}`, m.t)
    const onInvoice = (m: TeachInvoiceMessage) => {
      if (!mine(m)) return
      invoiceRef.current = m.invoiceId
      setInvoice({ id: m.invoiceId, label: m.label })
      if (cueRef.current && cueRef.current.invoiceId !== m.invoiceId && cueRef.current.status === 'waiting') {
        cueRef.current = { ...cueRef.current, status: 'expired' } // a cue for the previous invoice is stale
        setCue(cueRef.current)
      }
    }
    const onCue = (m: TeachCueMessage) => {
      if (!mine(m)) return
      cueRef.current = { text: m.text, type: `${m.type} ${m.stepId}${m.boundary ? ' (boundary)' : ''}`, invoiceId: m.invoiceId, status: 'waiting', at: Date.now() }
      setCue(cueRef.current)
    }
    // "Before save": risk and block cues go out at once, and the expert's moment opens on screen.
    const onAlert = (kind: 'risk' | 'blocked') => (m: GuardrailAlertMessage) => {
      if (!mine(m)) return
      pushAlert(kind, m.invoiceId, m.guardrail.id)
      if (cueRef.current?.status === 'waiting') {
        cueRef.current = { ...cueRef.current, status: 'expired' }
        setCue(cueRef.current)
      }
      sendCue(m.text)
      openStepRef.current(m.guardrail.id)
    }
    const onRisk = onAlert('risk')
    const onBlocked = onAlert('blocked')
    const onResolved = (m: GuardrailResolvedMessage) => mine(m) && pushAlert('resolved', m.invoiceId, m.guardrailId)
    const onMastery = (m: MasteryUpdatedMessage) => mine(m) && setMastery(m.mastery)

    socket.on('screen_events', onScreen)
    socket.on('vision_error', onVisionError)
    socket.on('teach_invoice_opened', onInvoice)
    socket.on('teach_cue', onCue)
    socket.on('guardrail_risk', onRisk)
    socket.on('guardrail_blocked', onBlocked)
    socket.on('guardrail_resolved', onResolved)
    socket.on('mastery_updated', onMastery)
    return () => {
      socket.off('screen_events', onScreen)
      socket.off('vision_error', onVisionError)
      socket.off('teach_invoice_opened', onInvoice)
      socket.off('teach_cue', onCue)
      socket.off('guardrail_risk', onRisk)
      socket.off('guardrail_blocked', onBlocked)
      socket.off('guardrail_resolved', onResolved)
      socket.off('mastery_updated', onMastery)
    }
    // sendCue and openStep read refs, so registering once is enough.
  }, [add, sendContextualUpdate])
  const openStepRef = useRef(openStep)
  openStepRef.current = openStep

  // [PREDICT] / [STEP_START] wait for a quiet moment: tutor free, trainee silent, screen settled.
  useEffect(() => {
    const timer = setInterval(() => {
      const pending = cueRef.current
      if (!pending || pending.status !== 'waiting') return
      const t = Date.now()
      if (t - pending.at > CUE_EXPIRES_MS) {
        cueRef.current = { ...pending, status: 'expired' }
        setCue(cueRef.current)
        return
      }
      const quiet =
        connectedRef.current &&
        modeRef.current !== 'speaking' &&
        t - voice.current.lastAboveAt > RULES.talkingWindowMs &&
        t - (capture.lastScreenChangeAt.current ?? 0) > CUE_QUIET_SCREEN_MS
      if (!quiet) return
      if (sendCue(pending.text)) {
        cueRef.current = { ...pending, status: 'sent', t: tNow() }
        setCue(cueRef.current)
      }
    }, RULES.tickMs)
    return () => clearInterval(timer)
  }, [])

  const start = async () => {
    if (!TUTOR_AGENT_ID) {
      add('error', 'VITE_TUTOR_AGENT_ID is missing: run scripts/setup-agents.ts, then restart npm run dev.')
      return
    }
    if (!mapId) {
      add('error', 'No Work Map to teach from: run a capture and confirm the teach-back first.')
      return
    }
    setStarting(true)
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
      mic.getTracks().forEach((track) => track.stop())
      const tutorMap = await api.getTutorMap(mapId)
      const [s, expertRun] = await Promise.all([
        api.createSession({ mode: 'teach', mapId, trainee: TRAINEE, expert: tutorMap.map.expert, task: tutorMap.map.task }),
        api.getSession(tutorMap.map.sessionId),
      ])
      sessionRef.current = s
      setSession(s)
      setTutor(tutorMap)
      setExpertSession(expertRun)
      setEnded(false)
      setShowReport(false)
      setAlerts([])
      setMastery([])
      setInvoice(null)
      invoiceRef.current = undefined
      cueRef.current = null
      setCue(null)
      add('info', `Training ${TRAINEE.name} from ${tutorMap.map.expert.name}'s map ${tutorMap.map.id} (v${tutorMap.map.version})`, 0)
      startSession({
        agentId: TUTOR_AGENT_ID,
        connectionType: 'webrtc',
        dynamicVariables: {
          expert_name: tutorMap.map.expert.name,
          trainee_name: TRAINEE.name,
          task_name: 'processing supplier invoices before period close',
          work_map: tutorMap.tutorText,
        },
      })
    } catch (err) {
      add('error', `Could not start training: ${(err as Error).message}`)
    } finally {
      setStarting(false)
    }
  }

  const endTraining = () => {
    const s = sessionRef.current
    if (!s || ended) return
    setEnded(true)
    setShowReport(true)
    capture.stop()
    sendCue(
      `[SESSION_END] ${TRAINEE.name} has finished. In two sentences say what she mastered and what to practise next, then call show_mastery_report. Do not call skip_turn.`,
    )
    api.endSession(s.id).catch((err: Error) => add('error', `Could not end training: ${err.message}`, tNow()))
  }

  const stop = () => {
    const s = sessionRef.current
    if (s && !ended) api.endSession(s.id).catch(() => {})
    setEnded(true)
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

  const live = connected || status === 'connecting'
  const map = tutor?.map

  return (
    <div className="appr">
      <nav className="appr-crumbs">
        <a href="/apprentice">← Home</a>
        <a href="/apprentice?mode=capture">Teach the apprentice instead</a>
      </nav>
      <header className="appr-head">
        <div className="appr-head-left">
          <PresenceOrb
            connected={connected}
            speaking={mode === 'speaking'}
            getInputVolume={conversation.getInputVolume}
            getOutputVolume={conversation.getOutputVolume}
          />
          <div>
            <h1>Train a new hire</h1>
            <div className="appr-sub">
              Coaching {TRAINEE.name} · {session ? `${session.id} · ${formatT(sessionT(session.startedAtMs, now))}` : 'no session yet'}
            </div>
          </div>
        </div>
        <div className="appr-head-right">
          <span className={`status status-${status}`}>{status === 'connected' ? (mode === 'speaking' ? 'Speaking' : 'Listening') : status}</span>
          {live ? (
            <button type="button" className="appr-btn" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="button" className="appr-btn appr-btn-primary" onClick={() => void start()} disabled={starting || !mapId}>
              {starting ? 'Starting…' : 'Start training'}
            </button>
          )}
        </div>
      </header>

      {!TUTOR_AGENT_ID && <div className="appr-alert">VITE_TUTOR_AGENT_ID is missing. Run setup-agents, then restart npm run dev.</div>}

      {!ended && !(connected && capture.sharing) && (
        <GetReady
          title="Get ready"
          steps={[
            {
              label: 'Choose the Work Map to teach from',
              detail: maps.length ? (
                <select className="appr-input" value={mapId} onChange={(e) => setMapId(e.target.value)} disabled={session !== null}>
                  {maps.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.expert.name} · {m.id} · v{m.version} · {m.steps} steps · {m.guardrails} guardrails · teach-back {m.teachback}
                      {m.confirmedAt ? ` ${m.confirmedAt.slice(0, 16).replace('T', ' ')}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                'No Work Map yet: teach the apprentice first and confirm the teach-back.'
              ),
              done: Boolean(mapId),
            },
            {
              label: `Open ${TRAINEE.name}'s queue in its own window`,
              detail: 'The Sandbox ERP. Reset it from its sidebar for a fresh run.',
              done: erpOpen,
              action: { label: 'Open ERP window', onClick: () => openErpWindow('trainee') },
            },
            {
              label: 'Start training',
              detail: 'Allow the microphone. Headphones keep the tutor from hearing itself.',
              done: connected,
              action: { label: starting ? 'Starting…' : 'Start training', onClick: () => void start(), disabled: starting || live || !mapId },
            },
            {
              label: 'Share the ERP window',
              detail: 'Pick the Sandbox ERP window in the browser prompt, not this one.',
              done: capture.sharing,
              action: { label: 'Share screen', onClick: share, disabled: !session },
            },
          ]}
        />
      )}

      {map && session && (
        <TutorPanel
          map={map}
          expertName={expert.name}
          traineeName={TRAINEE.name}
          invoice={invoice}
          cue={cue}
          alerts={alerts}
          mastery={mastery}
          ended={ended}
          onEndTraining={endTraining}
        />
      )}

      {map && showReport && <MasteryReport map={map} mastery={mastery} expertName={expert.name} traineeName={TRAINEE.name} />}

      {session && !ended && (
        <CapturePanel
          sessionId={session.id}
          sharing={capture.sharing}
          stream={capture.stream}
          diff={capture.diff}
          threshold={diffThreshold}
          lastChangeAt={capture.lastChangeAt}
          framesSent={capture.framesSent}
          paused={capture.paused}
          lastVision={null}
          onShare={share}
          onStopSharing={capture.stop}
        />
      )}

      <section className="appr-card">
        <h2>Live feed</h2>
        <LiveFeed entries={entries.filter((e) => FEED_KINDS.has(e.kind))} empty="The conversation and screen events appear here." />
      </section>

      {debug && (
        <details className="appr-card debug" open>
          <summary>Debug: full log</summary>
          <LiveFeed entries={entries} />
        </details>
      )}

      {replay && map && (
        <ReplayModal
          sessionId={map.sessionId}
          frames={expertSession?.frames ?? []}
          words={expertWords(expertSession)}
          target={replay}
          expertName={expert.name}
          onClose={() => setReplay(null)}
        />
      )}
    </div>
  )
}
