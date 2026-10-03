import { useCallback, useEffect, useRef, useState } from 'react'
import type { DraftPatch } from '@apprentice/shared'
import { erpApi } from './erpApi.ts'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Debounced draft autosave: edits are merged and sent as one PATCH after `delayMs` of quiet.
 * PATCHes are chained so they reach the server in order. `flush()` sends anything pending
 * now and resolves to false if the last save failed (callers then skip the action).
 */
export function useDraftAutosave(invoiceId: string, delayMs = 300) {
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<DraftPatch>({})
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const chain = useRef<Promise<boolean>>(Promise.resolve(true))

  const send = useCallback((): Promise<boolean> => {
    timer.current = undefined
    const patch = pending.current
    pending.current = {}
    if (Object.keys(patch).length === 0) return chain.current
    chain.current = chain.current
      .then(() => erpApi.patchDraft(invoiceId, patch))
      .then(
        () => {
          if (!timer.current) setSaveState('saved')
          setError(null)
          return true
        },
        (err: Error) => {
          setSaveState('error')
          setError(err.message)
          return false
        },
      )
    return chain.current
  }, [invoiceId])

  const queue = useCallback(
    (patch: DraftPatch) => {
      pending.current = { ...pending.current, ...patch }
      setSaveState('saving')
      clearTimeout(timer.current)
      timer.current = setTimeout(send, delayMs)
    },
    [send, delayMs],
  )

  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current)
      return send()
    }
    return chain.current
  }, [send])

  // Don't lose an edit made just before navigating away.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        void send()
      }
    },
    [send],
  )

  return { queue, flush, saveState, error }
}
