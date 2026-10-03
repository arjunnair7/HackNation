// Tiny-canvas change detection (BUILD_PLAN Phase 3).

export const DIFF_WIDTH = 96
export const DIFF_HEIGHT = 54

/**
 * Default threshold for meanAbsDiff on the 96×54 grayscale frame.
 * Measured on ERP screenshots: a cost-center or asset-number edit ≈ 0.0003, three typed
 * characters ≈ 0.0001, a tab or page switch ≈ 0.035–0.05. The plan's starting value (0.02)
 * only catches page switches, so field edits would never produce a frame.
 * Override with /apprentice?diff=0.0005.
 */
export const DEFAULT_DIFF_THRESHOLD = 0.0001

/** RGBA pixels → luma per pixel, 0..1. */
export function toGray(rgba: Uint8ClampedArray): Float32Array {
  const gray = new Float32Array(rgba.length / 4)
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    gray[j] = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255
  }
  return gray
}

/** Mean absolute per-pixel difference, 0..1. */
export function meanAbsDiff(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}
