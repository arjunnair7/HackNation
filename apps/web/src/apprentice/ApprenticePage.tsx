import { useEffect, useState } from 'react'
import { getSocket } from './lib/socket.ts'

/** Placeholder for Window B. Phase 3 replaces this with AgentShell + capture + Brain panel. */
export function ApprenticePage() {
  const [status, setStatus] = useState('connecting…')
  const [rttMs, setRttMs] = useState<number | null>(null)

  useEffect(() => {
    document.title = 'Apprentice'
    const socket = getSocket()
    const ping = async () => {
      const started = performance.now()
      try {
        await socket.timeout(2000).emitWithAck('ping', { sentAt: Date.now() })
        setRttMs(Math.round(performance.now() - started))
      } catch {
        setRttMs(null)
      }
    }
    const onConnect = () => {
      setStatus('connected')
      void ping()
    }
    const onDisconnect = () => setStatus('disconnected')
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    if (socket.connected) onConnect()
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [])

  return (
    <main className="plain-page">
      <h1>Apprentice</h1>
      <p>Voice agent, screen capture and the Brain panel arrive in Phase 3.</p>
      <p>
        Socket: <strong>{status}</strong>
        {rttMs !== null && <> · ping {rttMs} ms</>}
      </p>
    </main>
  )
}
