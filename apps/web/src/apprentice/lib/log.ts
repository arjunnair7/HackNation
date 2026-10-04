import { useCallback, useRef, useState } from 'react'

export type LogKind = 'expert' | 'agent' | 'screen' | 'answer' | 'cue' | 'tool' | 'info' | 'error'

export interface LogEntry {
  id: number
  at: number // wall clock
  t?: number // session clock
  kind: LogKind
  text: string
  ref?: string // server id (utterance, screen event, answer): can be struck from the record
  struck?: boolean
}

/** Rolling in-memory log for the live feed and the debug drawer. */
export function useLog(max = 300) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const nextId = useRef(0)
  const add = useCallback(
    (kind: LogKind, text: string, t?: number, ref?: string) => {
      const entry: LogEntry = { id: nextId.current++, at: Date.now(), t, kind, text, ref }
      setEntries((prev) => [...prev.slice(-(max - 1)), entry])
    },
    [max],
  )
  const markStruck = useCallback((ref: string) => {
    setEntries((prev) => prev.map((e) => (e.ref === ref ? { ...e, struck: true } : e)))
  }, [])
  /** Off the record: captured content from `t` on disappears from the feed too. */
  const dropFrom = useCallback((t: number) => {
    const captured = new Set<LogKind>(['expert', 'agent', 'screen', 'answer'])
    setEntries((prev) => prev.filter((e) => !(captured.has(e.kind) && e.t !== undefined && e.t >= t)))
  }, [])
  return { entries, add, markStruck, dropFrom }
}
