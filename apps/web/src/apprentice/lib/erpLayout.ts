import { useEffect, useState } from 'react'
import type { ErpLayoutMessage, ErpQueue } from '@apprentice/shared'
import { getSocket } from './socket.ts'

export interface MaskRect {
  x: number
  y: number
  w: number
  h: number
}

const PAD_PX = 8 // CSS px of slack around the orb box
const SEEN_WITHIN_MS = 7000 // the ERP reports every 3 s
const KEEP_MS = 60_000 // generous, so a briefly throttled ERP tab doesn't make the mask flicker
const WIDTH_MATCH = 0.03
const layouts = new Map<string, { message: ErpLayoutMessage; at: number }>()
let watching = false

/** Keeps the latest layout of every open ERP window (each reports where its orb is every few seconds). */
export function watchErpLayout() {
  if (watching) return
  watching = true
  getSocket().on('erp_layout', (message: ErpLayoutMessage) => {
    if (message?.windowId && message.viewport?.w && message.mask?.w) layouts.set(message.windowId, { message, at: Date.now() })
  })
}

const lastSeenAt = () => Math.max(0, ...[...layouts.values()].map((l) => l.at))

/** Starts watching the ERP layout; true while an ERP window is open somewhere. */
export function useErpWindow(): boolean {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    watchErpLayout()
    const check = () => setSeen(Date.now() - lastSeenAt() < SEEN_WITHIN_MS)
    check()
    const timer = setInterval(check, 1000)
    return () => clearInterval(timer)
  }, [])
  return seen
}

/** Opens (or refocuses) the ERP in its own window, ready to be shared. */
export function openErpWindow(queue: ErpQueue) {
  window.open(`/erp?queue=${queue}`, 'sandbox-erp', 'popup,width=1280,height=860')
}

/**
 * The orb's box in captured-video pixels, so capture blanks it out and vision never sees it move.
 * A shared window is the page viewport with browser chrome above it, at the same width, so the
 * box is anchored to the bottom of the video. With several ERP windows open, the ones whose width
 * matches the video are the shared one; if none match (a scaled video), every box is blanked.
 * Returns a stable set, so the mask itself never registers as a screen change.
 */
export function erpOrbMasks(videoW: number, videoH: number): MaskRect[] {
  const now = Date.now()
  const fresh: ErpLayoutMessage[] = []
  for (const [id, { message, at }] of layouts) {
    if (now - at > KEEP_MS) layouts.delete(id)
    else fresh.push(message)
  }
  const matching = fresh.filter((m) => Math.abs(m.viewport.w * (m.dpr || 1) - videoW) / videoW < WIDTH_MATCH)
  return (matching.length ? matching : fresh).map(({ mask, viewport }) => {
    const s = videoW / viewport.w
    return {
      x: (mask.x - PAD_PX) * s,
      y: videoH - (viewport.h - mask.y + PAD_PX) * s,
      w: (mask.w + 2 * PAD_PX) * s,
      h: (mask.h + 2 * PAD_PX) * s,
    }
  })
}
