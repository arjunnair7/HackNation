import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { MapUpdatedMessage, WorkMap } from '@apprentice/shared'
import { api } from './lib/api.ts'
import { getSocket } from './lib/socket.ts'
import { WorkMapView } from './panels/WorkMapView.tsx'
import './apprentice.css'

/** /map/:sessionId: one session's Work Map on its own page (review, demo, after a reload). */
export function MapPage() {
  const { sessionId = '' } = useParams()
  const [map, setMap] = useState<WorkMap | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Work Map'
    api.getMap(sessionId).then(setMap, (err: Error) => setError(err.message))
    const socket = getSocket()
    const onMap = (m: MapUpdatedMessage) => m.sessionId === sessionId && setMap(m.map)
    socket.on('map_updated', onMap)
    return () => {
      socket.off('map_updated', onMap)
    }
  }, [sessionId])

  const strike = (id: string, struck: boolean) => {
    api.mapStrike(sessionId, { id, struck }).then(setMap, (err: Error) => setError(err.message))
  }

  return (
    <div className="appr appr-wide">
      <header className="appr-head">
        <div>
          <h1>Work Map</h1>
          <div className="appr-sub">
            {map ? `${map.expert.name}, ${map.expert.role} · ${map.task} · v${map.version}` : sessionId}
          </div>
        </div>
      </header>
      {error && <div className="appr-alert">{error}</div>}
      {map ? <WorkMapView sessionId={sessionId} map={map} expertName={map.expert.name} onStrike={strike} /> : !error && <p className="appr-muted">Loading…</p>}
    </div>
  )
}
