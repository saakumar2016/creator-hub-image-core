// The part that touches the network and onnxruntime-web: download the model with progress, make a session, run one photo. Used by the worker and by the
// main-thread fallback. The runtime is passed in (`ort`), so this file imports none of it: the worker imports it statically, the fallback loads it on demand.
import { finish, MODEL_SIZE, prepare } from './core.ts'
import { abortError, BackgroundError, BackgroundModelError, type Cutout, type RgbaImage } from './types.ts'

/** The part of onnxruntime-web that is used. */
export type OrtLike = {
  env: { wasm: { numThreads?: number; proxy?: boolean | string; wasmPaths?: string | Record<string, string> } }
  InferenceSession: { create(bytes: Uint8Array, options: { executionProviders: string[]; graphOptimizationLevel?: string }): Promise<SessionLike> }
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown
}
export type SessionLike = {
  inputNames: readonly string[]
  outputNames: readonly string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number> }>>
}

/** Downloads `url` as bytes, telling `report` how many bytes have arrived. `total` is the size to show 100 % at (0 = use Content-Length, or unknown). */
export async function downloadModel(url: string, total: number, report: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
  let response: Response
  try {
    response = await fetch(url, { credentials: 'omit', signal })
  } catch (error) {
    if (signal?.aborted) throw abortError()
    throw new BackgroundModelError(`Could not load the model from ${url}`, { cause: error })
  }
  if (!response.ok) throw new BackgroundModelError(`Could not load the model from ${url} (status ${response.status})`)
  const size = total || Number(response.headers.get('Content-Length')) || 0
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    report(bytes.length, size || bytes.length)
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.length
      report(size ? Math.min(loaded, size) : loaded, size)
    }
  } catch (error) {
    if (signal?.aborted) throw abortError()
    throw new BackgroundModelError(`The model download from ${url} stopped`, { cause: error })
  }
  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

/** A model session on the CPU wasm runtime (one thread, no proxy worker: we are already in a worker, or the fallback is allowed to be slow). */
export async function createSession(ort: OrtLike, bytes: Uint8Array, ortBase: string): Promise<SessionLike> {
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  ort.env.wasm.wasmPaths = ortBase // absolute: the loader module is imported from here
  try {
    return await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  } catch (error) {
    const text = String(error instanceof Error ? error.message : error)
    // onnxruntime says so when the FILE is not a model (an HTML page, a cut-off download): "Failed to load model because protobuf parsing failed". Anything else (the wasm
    // could not be fetched or compiled, the loader module is missing) is the runtime's problem, and the message says where its files must be.
    if (/protobuf|Failed to load model|ModelProto|INVALID_PROTOBUF/i.test(text)) throw new BackgroundModelError('The model file is not a valid ONNX model', { cause: error })
    throw new BackgroundError(`The onnxruntime-web files could not be started (${text}). They must be served from ${ortBase}`, { cause: error })
  }
}

/** A typed array that cannot be allocated is a `RangeError`: say what it means. */
export const memoryError = (error: unknown): BackgroundError | null =>
  error instanceof RangeError && /allocation|Invalid typed array length|Array buffer allocation/i.test(error.message) ? new BackgroundError('There is not enough memory for a photo this big. Try a smaller one.', { cause: error }) : null

/** One photo through the model: its cut-out at its own size. */
export async function cutOut(ort: OrtLike, session: SessionLike, image: RgbaImage): Promise<Cutout> {
  const input = prepare(image)
  const result = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE]) })
  const output = result[session.outputNames[0]]
  if (!output || output.data.length !== MODEL_SIZE * MODEL_SIZE) throw new BackgroundModelError(`The model gave an output of ${output?.data.length ?? 0} values, not ${MODEL_SIZE * MODEL_SIZE}: it is not u2netp`)
  return finish(image, output.data)
}
