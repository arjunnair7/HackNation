import { useCallback, useRef, useState } from 'react'

export type LogKind = 'expert' | 'agent' | 'screen' | 'cue' | 'tool' | 'info' | 'error'

export interface LogEntry {
  id: number
  at: number // wall clock
  t?: number // session clock
  kind: LogKind
  text: string
}

/** Rolling in-memory log for the live feed and the debug drawer. */
export function useLog(max = 300) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const nextId = useRef(0)
  const add = useCallback(
    (kind: LogKind, text: string, t?: number) => {
      const entry: LogEntry = { id: nextId.current++, at: Date.now(), t, kind, text }
      setEntries((prev) => [...prev.slice(-(max - 1)), entry])
    },
    [max],
  )
  return { entries, add }
}
