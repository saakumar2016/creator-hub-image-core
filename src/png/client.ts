// The main-thread side: checks the input, starts a worker for this one call, passes progress on, and ends the worker on
// success, error or abort. `compressPngWith` takes the worker factory and the wasm URL so a test can supply a fake worker;
// index.ts supplies the real ones.
import { PNG_MAX_PIXELS, PngCompressError, PngTooLargeError, abortError, resolveOptions, type PngCompressOptions, type PngCompressResult, type RgbaImage } from './types.ts'
import { toRequestImage, type WorkerRequest, type WorkerResponse } from './protocol.ts'

export type WorkerLike = {
  postMessage(message: WorkerRequest, transfer: Transferable[]): void
  terminate(): void
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

export function compressPngWith(spawn: () => WorkerLike, wasmUrl: string, image: RgbaImage, options: PngCompressOptions = {}): Promise<PngCompressResult> {
  const { targetBytes, minColors, level } = resolveOptions(options)
  const pixels = image.width * image.height
  if (!(image.width > 0 && image.height > 0)) throw new RangeError('The image must have a width and a height')
  if (pixels > PNG_MAX_PIXELS) throw new PngTooLargeError(pixels)
  if (image.data.byteLength < pixels * 4) throw new RangeError('The image must be RGBA with width × height × 4 bytes')
  const { signal, onProgress } = options
  if (signal?.aborted) return Promise.reject(abortError())

  return new Promise<PngCompressResult>((resolve, reject) => {
    let worker: WorkerLike
    try {
      worker = spawn()
    } catch (error) {
      return reject(new PngCompressError('The PNG worker could not be started', { cause: error }))
    }
    const finish = () => {
      signal?.removeEventListener('abort', onAbort)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }
    const onAbort = () => {
      finish()
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') return onProgress?.(data.progress)
      finish()
      if (data.type === 'done') {
        const blob = new Blob([data.bytes], { type: 'image/png' })
        resolve({ blob, bytes: blob.size, colors: data.colors, reachedTarget: data.reachedTarget })
      } else reject(new PngCompressError(data.message))
    }
    worker.onerror = (event) => {
      finish()
      reject(new PngCompressError(event.message || 'The PNG worker failed'))
    }
    const request: WorkerRequest = { type: 'run', image: toRequestImage(image), options: { targetBytes, minColors, level }, wasmUrl }
    worker.postMessage(request, [request.image.data])
  })
}
