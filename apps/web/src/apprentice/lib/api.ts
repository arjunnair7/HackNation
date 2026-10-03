import type {
  CreateSessionRequest,
  DebugEventRequest,
  FrameUploadRequest,
  FrameUploadResponse,
  ScreenEvent,
  Session,
  TranscriptRequest,
  Utterance,
} from '@apprentice/shared'

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message = (data as { message?: unknown } | null)?.message
    throw new Error(typeof message === 'string' ? message : `${path} failed (${res.status})`)
  }
  return data as T
}

export const api = {
  createSession: (body: CreateSessionRequest) => post<Session>('/sessions', body),
  postTranscript: (sessionId: string, body: TranscriptRequest) =>
    post<Utterance>(`/sessions/${sessionId}/transcript`, body),
  postFrame: (sessionId: string, body: FrameUploadRequest) =>
    post<FrameUploadResponse>(`/sessions/${sessionId}/frames`, body),
  injectEvent: (sessionId: string, body: DebugEventRequest) => post<ScreenEvent>(`/sessions/${sessionId}/events`, body),
  frameUrl: (sessionId: string, frameId: string) => `/api/sessions/${sessionId}/frames/${frameId}`,
}
