// Messages between the main thread and the PNG worker.
import type { PngProgress, RgbaImage } from './types.ts'

export type WorkerRequest = {
  type: 'run'
  /** The pixels (a copy, transferred) and the options without the parts that cannot be cloned. */
  image: { data: ArrayBuffer; width: number; height: number }
  options: { targetBytes?: number; minColors: 64 | 128 | 256; level: 1 | 2 }
  /** Absolute URL of the oxipng wasm file (a blob worker cannot resolve a relative one). */
  wasmUrl: string
}
export type WorkerResponse =
  | { type: 'progress'; progress: PngProgress }
  | { type: 'done'; bytes: ArrayBuffer; colors: number; reachedTarget: boolean }
  | { type: 'error'; name: string; message: string }

export const toRequestImage = (image: RgbaImage): WorkerRequest['image'] => {
  // A copy: the caller's ImageData keeps its pixels; the copy is transferred to the worker.
  const copy = new Uint8Array(image.data.byteLength)
  copy.set(image.data)
  return { data: copy.buffer, width: image.width, height: image.height }
}
