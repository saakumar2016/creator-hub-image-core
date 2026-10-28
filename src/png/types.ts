// Shared types, limits and errors of the PNG compressor ("reduce colours, the file stays a PNG"). No imports, so this file is
// safe to load anywhere (tests, the main thread, the worker).

/**
 * More pixels than this are refused (`PngTooLargeError`). Measured in Chrome (Prompt #115 spike, Vite 8): a 12 MP image took
 * 36-45 s with oxipng level 3 and +300-450 MB of memory; the tool can offer WebP instead.
 */
export const PNG_MAX_PIXELS = 12_000_000

/** The colour counts tried, highest first. Below 64 the spike showed visible banding on photos. */
export const PNG_COLOUR_LADDER = [256, 128, 64] as const
export type PngColours = (typeof PNG_COLOUR_LADDER)[number]

export type PngProgress = {
  /** 'quantize': building the palette; 'optimize': the lossless oxipng pass. */
  stage: 'quantize' | 'optimize'
  /** The colour count of the rung being worked on (the image's own count when it has 256 or fewer). */
  colors: number
}

export type PngCompressOptions = {
  /** The file size to stay under. Omitted: one pass at the top of the ladder (256 colours), then oxipng. */
  targetBytes?: number
  /** The lowest colour count tried: 64 (default), 128 or 256. */
  minColors?: PngColours
  /** oxipng level, 1 or 2 (default 2). Level 3 saves a few percent more but takes 4-6 s per 1.5 MP. */
  level?: 1 | 2
  /** Aborting terminates the worker and rejects with an `AbortError`. */
  signal?: AbortSignal
  onProgress?: (progress: PngProgress) => void
}

export type PngCompressResult = {
  blob: Blob
  /** `blob.size`. */
  bytes: number
  /** Colours in the result's palette (at most 256). */
  colors: number
  /** False when even the lowest rung is over `targetBytes`: the result is that lowest rung. Always true without a target. */
  reachedTarget: boolean
}

/** More than `PNG_MAX_PIXELS`. */
export class PngTooLargeError extends Error {
  readonly pixels: number
  readonly maxPixels: number
  constructor(pixels: number, maxPixels: number = PNG_MAX_PIXELS) {
    super(`The image has ${pixels} pixels; PNG compression is limited to ${maxPixels}`)
    this.name = 'PngTooLargeError'
    this.pixels = pixels
    this.maxPixels = maxPixels
  }
}

/** The worker or the wasm failed (could not start, could not load the wasm file, threw). */
export class PngCompressError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PngCompressError'
  }
}

/** A rejection like the one `fetch` gives for an aborted request. */
export const abortError = (): DOMException => new DOMException('PNG compression was aborted', 'AbortError')

/** The image the compressor takes: the part of `ImageData` it reads (RGBA, 8 bits per channel, not premultiplied). */
export type RgbaImage = { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

/** Checks the options and fills the defaults; throws RangeError for a value outside what the ladder supports. */
export type ResolvedPngOptions = { targetBytes?: number; minColors: PngColours; level: 1 | 2 }

export function resolveOptions(options: PngCompressOptions = {}): ResolvedPngOptions {
  const { targetBytes, minColors = 64, level = 2 } = options
  if (targetBytes !== undefined && !(Number.isFinite(targetBytes) && targetBytes > 0)) throw new RangeError('targetBytes must be a positive number')
  if (!(PNG_COLOUR_LADDER as readonly number[]).includes(minColors)) throw new RangeError('minColors must be 64, 128 or 256')
  if (level !== 1 && level !== 2) throw new RangeError('level must be 1 or 2')
  return { targetBytes, minColors, level }
}
