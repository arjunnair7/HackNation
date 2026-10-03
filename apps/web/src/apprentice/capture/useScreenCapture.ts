import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_DIFF_THRESHOLD, DIFF_HEIGHT, DIFF_WIDTH, meanAbsDiff, toGray } from './frameDiff.ts'

export interface CapturedFrame {
  jpegBase64: string
  capturedAt: number // Date.now() when grabbed
}

export interface ScreenCaptureOptions {
  /** A settled screen that differs from the last frame sent. */
  onFrame: (frame: CapturedFrame) => void
  /** The screen is changing (typing, scrolling, navigating). Throttled to once per second. */
  onActivity?: () => void
  threshold?: number
  sampleMs?: number
  settleMs?: number
  maxWidth?: number
  jpegQuality?: number
}

interface Runner {
  stream: MediaStream
  timer: ReturnType<typeof setInterval>
}

/**
 * Shares a window and watches it at 2 Hz on a 96×54 grayscale canvas.
 * - consecutive samples differ → the screen is changing: record lastScreenChangeAt, signal activity
 * - the screen has been still for `settleMs` and differs from the last frame sent → grab a full
 *   JPEG (≤ maxWidth px) and hand it to onFrame. Comparing against the last frame sent (not just
 *   the previous sample) means slow typing still adds up to a frame.
 */
export function useScreenCapture(options: ScreenCaptureOptions) {
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  const runner = useRef<Runner | null>(null)
  const lastScreenChangeAt = useRef(0)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [diff, setDiff] = useState(0)
  const [lastChangeAt, setLastChangeAt] = useState(0)
  const [framesSent, setFramesSent] = useState(0)

  const stop = useCallback(() => {
    const r = runner.current
    if (!r) return
    runner.current = null
    clearInterval(r.timer)
    r.stream.getTracks().forEach((track) => track.stop())
    setStream(null)
    setDiff(0)
  }, [])

  const start = useCallback(async () => {
    if (runner.current) return
    const media = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 5, displaySurface: 'window' }, // preselect the Window tab in the picker
      audio: false,
      selfBrowserSurface: 'exclude', // never offer this (apprentice) tab itself
    } as DisplayMediaStreamOptions)

    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = media
    await video.play()

    const tiny = document.createElement('canvas')
    tiny.width = DIFF_WIDTH
    tiny.height = DIFF_HEIGHT
    const tinyCtx = tiny.getContext('2d', { willReadFrequently: true })!
    const full = document.createElement('canvas')
    const fullCtx = full.getContext('2d')!

    let previous: Float32Array | null = null
    let lastSent: Float32Array | null = null
    let lastActivityAt = 0

    const grab = (): string => {
      const scale = Math.min(1, (optionsRef.current.maxWidth ?? 1280) / video.videoWidth)
      full.width = Math.round(video.videoWidth * scale)
      full.height = Math.round(video.videoHeight * scale)
      fullCtx.drawImage(video, 0, 0, full.width, full.height)
      const dataUrl = full.toDataURL('image/jpeg', optionsRef.current.jpegQuality ?? 0.75)
      return dataUrl.slice(dataUrl.indexOf(',') + 1)
    }

    const tick = () => {
      if (video.readyState < 2 || !video.videoWidth) return
      const { threshold = DEFAULT_DIFF_THRESHOLD, settleMs = 800 } = optionsRef.current
      const now = Date.now()

      tinyCtx.drawImage(video, 0, 0, DIFF_WIDTH, DIFF_HEIGHT)
      const current = toGray(tinyCtx.getImageData(0, 0, DIFF_WIDTH, DIFF_HEIGHT).data)
      const d = previous ? meanAbsDiff(previous, current) : 0
      previous = current
      setDiff(d)

      if (d > threshold) {
        lastScreenChangeAt.current = now
        setLastChangeAt(now)
        if (now - lastActivityAt >= 1000) {
          lastActivityAt = now
          optionsRef.current.onActivity?.()
        }
        return
      }

      const settled = now - lastScreenChangeAt.current >= settleMs
      const dirty = !lastSent || meanAbsDiff(lastSent, current) > threshold
      if (settled && dirty) {
        lastSent = current
        setFramesSent((n) => n + 1)
        optionsRef.current.onFrame({ jpegBase64: grab(), capturedAt: now })
      }
    }

    media.getVideoTracks()[0]?.addEventListener('ended', stop) // "Stop sharing" in the browser bar
    runner.current = { stream: media, timer: setInterval(tick, optionsRef.current.sampleMs ?? 500) }
    setStream(media)
  }, [stop])

  useEffect(() => stop, [stop])

  return { start, stop, stream, sharing: stream !== null, diff, lastChangeAt, framesSent, lastScreenChangeAt }
}
