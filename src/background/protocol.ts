// The messages between the page and the background worker.
export type ToWorker = {
  type: 'run'
  /** The call these messages belong to. */
  run: number
  modelUrl: string
  ortBase: string
  /** 0 = take the size from Content-Length. */
  modelBytes: number
  /** RGBA pixels of the photo at its own size (transferred, not copied). */
  pixels: ArrayBuffer
  width: number
  height: number
}

export type FromWorker =
  | { type: 'download'; run: number; loaded: number; total: number }
  | { type: 'working'; run: number }
  /** The cut-out, RGBA at the photo's size (transferred). */
  | { type: 'done'; run: number; pixels: ArrayBuffer; width: number; height: number }
  | { type: 'error'; run: number; kind: 'model' | 'other'; message: string }
