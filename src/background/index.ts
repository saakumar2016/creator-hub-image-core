// @creator-hub/image-core/background: remove the background of a photo in the browser (U²-Net small, onnxruntime-web, in a Worker). A separate entry point:
// the main entry never imports this, so a tool that does not use it ships none of it. Load it when it is needed:
//   const { removeBackground, composeBackground } = await import('@creator-hub/image-core/background')
// Neither the model nor the runtime is downloaded before `removeBackground` is called. It needs Vite (`?worker&inline`): see the README section "Remove background".
import BackgroundWorker from './worker.ts?worker&inline'
import { composeRgba } from './core.ts'
import { createRemover, type WorkerLike } from './client.ts'
import { toCanvas, toRgba } from './source.ts'
import type { Cutout, ImageInput, RemoveBackgroundOptions, RgbaImage } from './types.ts'
import type { OrtLike } from './engine.ts'

export * from './types.ts'
export { composeRgba, parseHex } from './core.ts'

// The worker is bundled INTO this module (a Blob URL of the page's origin): `new Worker(<remote URL>)` is refused by the browser when the page is the shell's.
// The runtime for the main-thread fallback is loaded on demand, so it is a separate chunk that only a browser without workers ever fetches.
const remover = createRemover({
  spawn: () => {
    if (typeof Worker === 'undefined') throw new Error('Workers are not available')
    return new BackgroundWorker() as unknown as WorkerLike
  },
  loadOrt: () => import('onnxruntime-web/wasm') as unknown as Promise<OrtLike>,
})

/**
 * The cut-out of a photo: the photo at its own size, the background transparent. The first call in a page downloads the model (`onProgress` hears the bytes) and
 * the onnxruntime-web files; the next calls reuse them. The model runs in a Worker (on the main thread where workers are not available). Rejects with an
 * `AbortError` when `options.signal` aborts, with `BackgroundModelError` when the model cannot be loaded (a wrong `modelUrl`), with `BackgroundError` when the
 * runtime fails, and with a `RangeError` for an empty picture or one over 50 MP.
 */
export function removeBackground(image: ImageInput, options: RemoveBackgroundOptions): Promise<Cutout> {
  let pixels: RgbaImage
  try {
    pixels = toRgba(image)
  } catch (error) {
    return Promise.reject(error)
  }
  return remover(pixels, options)
}

/** The cut-out on a background: `'transparent'` or a hex colour (`#fff`, `#FFFFFF`). Returns a new canvas; the cut-out is not changed. */
export function composeBackground(cutout: Cutout | RgbaImage, background: 'transparent' | string): HTMLCanvasElement {
  return toCanvas(composeRgba(cutout, background))
}
