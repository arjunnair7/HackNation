import type {
  Answer,
  CreateSessionRequest,
  DebugEventRequest,
  FrameUploadRequest,
  FrameUploadResponse,
  MapAnswerRequest,
  MapCorrectionRequest,
  MapDraftResponse,
  MapStrikeRequest,
  MapSummary,
  MasteryRecord,
  Moment,
  MomentStatusRequest,
  OffRecordRequest,
  RecordAnswerRequest,
  RecordPredictionRequest,
  ScreenEvent,
  Session,
  StrikeRequest,
  TranscriptRequest,
  TutorMapResponse,
  Utterance,
  WorkMap,
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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`)
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
  recordAnswer: (sessionId: string, body: RecordAnswerRequest) => post<Answer>(`/sessions/${sessionId}/answers`, body),
  setMomentStatus: (sessionId: string, body: MomentStatusRequest) =>
    post<Moment[]>(`/sessions/${sessionId}/moments/status`, body),
  offRecord: (sessionId: string, body: OffRecordRequest) => post<Session['offRecord']>(`/sessions/${sessionId}/off-record`, body),
  strike: (sessionId: string, body: StrikeRequest) => post<string[]>(`/sessions/${sessionId}/strike`, body),
  mapDraft: (sessionId: string) => post<MapDraftResponse>(`/sessions/${sessionId}/map/draft`, {}),
  mapAnswer: (sessionId: string, body: MapAnswerRequest) => post<WorkMap>(`/sessions/${sessionId}/map/answer`, body),
  mapCorrection: (sessionId: string, body: MapCorrectionRequest) => post<WorkMap>(`/sessions/${sessionId}/map/correction`, body),
  mapConfirm: (sessionId: string) => post<WorkMap>(`/sessions/${sessionId}/map/confirm`, {}),
  mapStrike: (sessionId: string, body: MapStrikeRequest) => post<WorkMap>(`/sessions/${sessionId}/map/strike`, body),
  getSession: (sessionId: string) => get<Session>(`/sessions/${sessionId}`),
  getMap: (sessionId: string) => get<WorkMap>(`/sessions/${sessionId}/map`),
  listMaps: () => get<MapSummary[]>('/maps'),
  getTutorMap: (mapId: string) => get<TutorMapResponse>(`/maps/${mapId}/tutor`),
  recordPrediction: (sessionId: string, body: RecordPredictionRequest) => post<MasteryRecord[]>(`/sessions/${sessionId}/mastery`, body),
  endSession: (sessionId: string) => post<{ ended: true }>(`/sessions/${sessionId}/end`, {}),
  frameUrl: (sessionId: string, frameId: string) => `/api/sessions/${sessionId}/frames/${frameId}`,
}
