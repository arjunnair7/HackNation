import { useEffect, useState } from 'react'

/** Session clock: seconds since the session started (Session.startedAtMs). */
export function sessionT(startedAtMs: number, at = Date.now()): number {
  return Math.max(0, (at - startedAtMs) / 1000)
}

/** 192.4 → "03:12" */
export function formatT(t: number): string {
  const s = Math.floor(t)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Re-renders every `intervalMs` with the current time. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
