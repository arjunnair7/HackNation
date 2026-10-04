import { useEffect, useRef, useState } from 'react'
import type { AgentPresence } from '@apprentice/shared'
import { SiriOrb } from '../../components/SiriOrb.tsx'
import { getSocket } from '../lib/socket.ts'

const TICK_MS = 80

interface Props {
  connected: boolean
  speaking: boolean
  offRecord?: boolean
  getInputVolume: () => number
  getOutputVolume: () => number
  size?: number
}

export const presenceLabel: Record<AgentPresence['state'], string> = {
  off: 'Not connected',
  listening: 'Listening',
  speaking: 'Speaking',
  off_record: 'Off the record',
}

/**
 * The agent's orb in this window, and its mirror on the shared ERP: state and voice level go out
 * over socket.io (agent_presence) about 12 times a second. Own component, so the level ticks
 * re-render only the orb.
 */
export function PresenceOrb({ connected, speaking, offRecord = false, getInputVolume, getOutputVolume, size = 44 }: Props) {
  const state: AgentPresence['state'] = offRecord ? 'off_record' : !connected ? 'off' : speaking ? 'speaking' : 'listening'
  const [level, setLevel] = useState(0)
  const volumes = useRef({ getInputVolume, getOutputVolume })
  useEffect(() => {
    volumes.current = { getInputVolume, getOutputVolume }
  })

  useEffect(() => {
    const socket = getSocket()
    if (state === 'off') {
      setLevel(0)
      socket.emit('agent_presence', { state: 'off', level: 0 } satisfies AgentPresence)
      return
    }
    let smooth = 0
    const timer = setInterval(() => {
      let raw = 0
      try {
        if (state === 'speaking') raw = volumes.current.getOutputVolume()
        else if (state === 'listening') raw = volumes.current.getInputVolume()
      } catch {
        /* conversation just ended */
      }
      const target = Math.min(1, Math.sqrt(Math.max(0, raw)) * 1.25)
      smooth = smooth * 0.55 + target * 0.45
      const value = Number(smooth.toFixed(3))
      setLevel(value)
      socket.emit('agent_presence', { state, level: value } satisfies AgentPresence)
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [state])

  // Tell the ERP right away when this window closes, instead of waiting for its timeout.
  useEffect(() => {
    const bye = () => getSocket().emit('agent_presence', { state: 'off', level: 0 } satisfies AgentPresence)
    window.addEventListener('pagehide', bye)
    return () => {
      window.removeEventListener('pagehide', bye)
      bye()
    }
  }, [])

  return <SiriOrb state={state} level={level} size={size} label={`Apprentice: ${presenceLabel[state]}`} />
}
