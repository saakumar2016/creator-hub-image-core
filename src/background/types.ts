// Types and errors of @creator-hub/image-core/background (remove the background of a photo, in the browser).

/** Plain RGBA pixels, row by row, 4 bytes a pixel. A browser `ImageData` has this shape, so it can be passed as it is. */
export type RgbaImage = { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

/** What `removeBackground` accepts: pixels, or anything a canvas can read. */
export type ImageInput = RgbaImage | ImageBitmap | HTMLCanvasElement | OffscreenCanvas | HTMLImageElement

/** The cut-out: the photo at its own size with the background made transparent (alpha 0), the person or thing kept (alpha 255), a soft edge between. */
export type Cutout = { data: Uint8ClampedArray; width: number; height: number }

export type BackgroundProgress =
  /** The first call in a page downloads the model; `loaded` of `total` bytes (`total` is 0 when it is not known). Later calls do not send this. */
  | { stage: 'download'; loaded: number; total: number }
  /** The model is ready and is working on the photo. */
  | { stage: 'processing' }

export type RemoveBackgroundOptions = {
  /** Absolute URL of the U²-Net (u2netp) ONNX file. It is fetched only when `removeBackground` is called, and only once per page. */
  modelUrl: string
  /**
   * Absolute URL (ending in "/") of the folder with the onnxruntime-web files `ort-wasm-simd-threaded.mjs` and `.wasm`.
   * Default: `/ort/<onnxruntime-web version>/` on the origin of `modelUrl`.
   */
  ortBase?: string
  /** The size of the model file in bytes: the 100 % of the download bar (a server may compress, so Content-Length is not always the file's size). */
  modelBytes?: number
  /** Aborting rejects with an `AbortError` and stops the work (the worker is ended). */
  signal?: AbortSignal
  onProgress?: (progress: BackgroundProgress) => void
}

/** Something went wrong while removing the background (the worker, the wasm, the runtime or the model); the message says why. */
export class BackgroundError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BackgroundError'
  }
}

/** The model file could not be loaded: a wrong URL, a failed request or a file that is not an ONNX model. */
export class BackgroundModelError extends BackgroundError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BackgroundModelError'
  }
}

export const abortError = (): DOMException => new DOMException('The background removal was cancelled', 'AbortError')

/** The onnxruntime-web version the package was tested with: the default folder of its files is `/ort/<this>/`. */
export const ORT_VERSION = '1.30.0'

/** Where the runtime files are, by default: next to the model's origin. */
export function defaultOrtBase(modelUrl: string): string {
  return new URL(`/ort/${ORT_VERSION}/`, modelUrl).href
}
