// The pure part of the PNG compressor: which palette size to use. No DOM, no Worker, no wasm of its own: the two
// engines (UPNG for the palette, oxipng for the lossless pass) come in as `PngEngine`, so this runs in Node tests and in the worker.
import { PNG_COLOUR_LADDER, abortError, type PngProgress, type ResolvedPngOptions, type RgbaImage } from './types.ts'

export type PngEngine = {
  /** RGBA → a PNG with at most `colors` colours (UPNG: k-means); `colors` 0 = every colour, lossless. */
  encode(data: Uint8ClampedArray | Uint8Array, width: number, height: number, colors: number): Uint8Array
  /** A lossless pass over a PNG (oxipng, level 1 or 2). */
  optimise(png: Uint8Array, level: 1 | 2): Uint8Array | Promise<Uint8Array>
}

export type LadderHooks = { onProgress?: (progress: PngProgress) => void; aborted?: () => boolean }
export type LadderResult = { bytes: Uint8Array; colors: number; reachedTarget: boolean }

/**
 * oxipng saves at most this share of a palette PNG that UPNG wrote (level 1-2: at most about 15 % in the spike, on flat
 * graphics; 7-9 % on photos). A rung whose raw size times this is still over the target cannot get under it, so oxipng is not run on it.
 */
export const OXIPNG_BEST_RATIO = 0.8
/** Same bound for a truecolour PNG that has 256 colours or fewer: oxipng turns it into a palette PNG (spike: 75 KB → 42 KB). */
export const OXIPNG_BEST_RATIO_EXACT = 0.5

/** The number of different RGBA values, counted up to `limit` + 1 (it stops there). */
export function countColours(data: Uint8ClampedArray | Uint8Array, limit = 256): number {
  const aligned = data.byteOffset % 4 === 0 ? data : data.slice()
  const pixels = new Uint32Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / 4))
  const seen = new Set<number>()
  for (let i = 0; i < pixels.length; i++) {
    seen.add(pixels[i])
    if (seen.size > limit) return seen.size
  }
  return seen.size
}

const check = (hooks: LadderHooks) => {
  if (hooks.aborted?.()) throw abortError()
}

/**
 * Picks the palette: the HIGHEST colour count (256, 128, 64; not below `minColors`) whose final size, after the oxipng pass,
 * is at most `targetBytes`. Without a target: one pass at the top. If even the lowest rung misses, that rung is returned with
 * `reachedTarget: false`. An image with 256 colours or fewer is first tried exactly (its own colours, lossless) and only then lowered.
 */
export async function runLadder(image: RgbaImage, options: ResolvedPngOptions, engine: PngEngine, hooks: LadderHooks = {}): Promise<LadderResult> {
  const { targetBytes, minColors, level } = options
  const { data, width, height } = image
  const distinct = countColours(data)
  const exact = distinct <= 256
  const rungs: { colors: number; lossless: boolean }[] = []
  if (exact) rungs.push({ colors: distinct, lossless: true })
  // An exact image may also be lowered when its own palette is over the target; a rung at or above the image's own count adds nothing.
  for (const colors of PNG_COLOUR_LADDER) if (colors >= minColors && !(exact && colors >= distinct)) rungs.push({ colors, lossless: false })
  const first = rungs.slice(0, targetBytes === undefined ? 1 : rungs.length)
  if (!first.length) first.push({ colors: PNG_COLOUR_LADDER[0], lossless: false })

  let last: LadderResult | null = null
  for (const [index, rung] of first.entries()) {
    check(hooks)
    hooks.onProgress?.({ stage: 'quantize', colors: rung.colors })
    const raw = engine.encode(data, width, height, rung.lossless ? 0 : rung.colors)
    const isLast = index === first.length - 1
    const bound = rung.lossless ? OXIPNG_BEST_RATIO_EXACT : OXIPNG_BEST_RATIO
    // Clearly too big even after oxipng: skip the slow pass, unless it is the last rung (it is returned anyway).
    if (targetBytes !== undefined && !isLast && raw.length * bound > targetBytes) continue
    check(hooks)
    hooks.onProgress?.({ stage: 'optimize', colors: rung.colors })
    const optimised = await engine.optimise(raw, level)
    const bytes = optimised.length < raw.length ? optimised : raw
    last = { bytes, colors: rung.colors, reachedTarget: targetBytes === undefined || bytes.length <= targetBytes }
    if (last.reachedTarget) return last
  }
  // Only reachable when the last rung ran and missed (the last rung is never skipped).
  return last as LadderResult
}
