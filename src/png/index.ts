// @creator-hub/image-core/png: lossy PNG compression that keeps the file a PNG (fewer colours, then oxipng), run in a Worker.
// A separate entry point: the main entry never imports this, so a tool that does not use it ships none of it. Tools load it on demand:
//   const { compressPng } = await import('@creator-hub/image-core/png')
// It needs Vite (`?worker&inline`, `?url`): see the README section "PNG compress" for the consumer config.
import PngWorker from './worker.js?worker&inline'
import oxipngWasmUrl from '@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm?url'
import { compressPngWith, type WorkerLike } from './client.ts'
import type { PngCompressOptions, PngCompressResult, RgbaImage } from './types.ts'

export * from './types.ts'

// The worker is bundled INTO this module (a Blob URL of the page's origin): `new Worker(<remote URL>)` is refused by the browser
// when the page is the shell's. The wasm file stays a file; its URL is made absolute against this module's own URL, which is the
// remote's origin when the tool runs inside the shell.
const wasmUrl = (): string => new URL(oxipngWasmUrl, import.meta.url).href

/**
 * Reduces the colours of an RGBA image to at most 256, 128 or 64 and returns a PNG. See `PngCompressOptions` for the options and
 * `PngCompressResult` for what comes back. Throws `PngTooLargeError` above `PNG_MAX_PIXELS`, rejects with an `AbortError` when
 * `options.signal` aborts and with `PngCompressError` when the worker or the wasm fails.
 */
export function compressPng(image: RgbaImage, options?: PngCompressOptions): Promise<PngCompressResult> {
  try {
    return compressPngWith(() => new PngWorker() as unknown as WorkerLike, wasmUrl(), image, options)
  } catch (error) {
    return Promise.reject(error)
  }
}
