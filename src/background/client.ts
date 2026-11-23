// The main-thread side: starts the worker (once; it keeps the model for the next photo), passes progress on, handles Cancel, and falls back to the main thread
// where a worker cannot be used. `createRemover` takes the worker factory and the runtime loader so a test can supply fake ones; index.ts supplies the real ones.
import { cutOut, createSession, downloadModel, memoryError, type OrtLike, type SessionLike } from './engine.ts'
import type { FromWorker, ToWorker } from './protocol.ts'
import { abortError, BackgroundError, BackgroundModelError, defaultOrtBase, type Cutout, type RemoveBackgroundOptions, type RgbaImage } from './types.ts'

export type WorkerLike = {
  postMessage(message: ToWorker, transfer: Transferable[]): void
  terminate(): void
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

export type RemoverDeps = {
  /** A new worker; may throw when workers cannot be used (the main thread is used then). */
  spawn: () => WorkerLike
  /** The onnxruntime-web module, for the main-thread fallback only (loaded on demand). */
  loadOrt: () => Promise<OrtLike>
}

type Call = {
  options: RemoveBackgroundOptions
  resolve: (cutout: Cutout) => void
  reject: (error: unknown) => void
  /** The worker failed while this call waited: make it on the main thread instead. */
  fallBack: () => void
}

/** Checks the options that do not need the network. */
function resolveOptions(options: RemoveBackgroundOptions): { modelUrl: string; ortBase: string; modelBytes: number } {
  if (!options || typeof options.modelUrl !== 'string' || options.modelUrl === '') throw new BackgroundModelError('modelUrl is needed: the absolute URL of the u2netp model file')
  let modelUrl: string
  try {
    modelUrl = new URL(options.modelUrl).href
  } catch (error) {
    throw new BackgroundModelError(`modelUrl must be an absolute URL, not ${JSON.stringify(options.modelUrl)}`, { cause: error })
  }
  let ortBase: string
  try {
    ortBase = options.ortBase ? new URL(options.ortBase).href.replace(/\/*$/, '/') : defaultOrtBase(modelUrl)
  } catch (error) {
    throw new RangeError(`ortBase must be an absolute URL, not ${JSON.stringify(options.ortBase)}`, { cause: error })
  }
  const modelBytes = options.modelBytes ?? 0
  if (!(Number.isFinite(modelBytes) && modelBytes >= 0)) throw new RangeError('modelBytes must be a size in bytes')
  return { modelUrl, ortBase, modelBytes }
}

export function createRemover(deps: RemoverDeps) {
  let worker: WorkerLike | null = null
  let unusable = false // a worker failed to start: the main thread from now on
  let next = 1
  const calls = new Map<number, Call>()
  const mainSessions = new Map<string, MainEntry>()

  const stopWorker = () => {
    if (!worker) return
    worker.onmessage = null
    worker.onerror = null
    worker.terminate()
    worker = null
  }

  function startWorker(): WorkerLike {
    const started = deps.spawn()
    started.onmessage = ({ data }) => {
      const call = calls.get(data.run)
      if (!call) return // cancelled meanwhile
      if (data.type === 'download') return call.options.onProgress?.({ stage: 'download', loaded: data.loaded, total: data.total })
      if (data.type === 'working') return call.options.onProgress?.({ stage: 'processing' })
      calls.delete(data.run)
      if (data.type === 'done') call.resolve({ data: new Uint8ClampedArray(data.pixels), width: data.width, height: data.height })
      else call.reject(data.kind === 'model' ? new BackgroundModelError(data.message) : new BackgroundError(data.message))
    }
    started.onerror = failWorker
    return started
  }

  /** The worker itself failed (blocked, a script error, a message it cannot take): end it and make every waiting photo on the main thread. */
  function failWorker(): void {
    const waiting = [...calls.values()]
    calls.clear()
    stopWorker()
    unusable = true
    for (const call of waiting) call.fallBack()
  }

  return function removeBackground(image: RgbaImage, options: RemoveBackgroundOptions): Promise<Cutout> {
    let resolved: { modelUrl: string; ortBase: string; modelBytes: number }
    try {
      resolved = resolveOptions(options)
    } catch (error) {
      return Promise.reject(error)
    }
    const { signal } = options
    if (signal?.aborted) return Promise.reject(abortError())

    return new Promise<Cutout>((resolve, reject) => {
      const id = next++
      let settled = false
      const done = (action: () => void) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        calls.delete(id)
        action()
      }
      const onAbort = () => {
        done(() => reject(abortError()))
        if (calls.size === 0) stopWorker() // nobody else waits: end the worker (the session is lost: the next call downloads the model again, from the browser's cache if the server allows it)
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      const viaMain = () => {
        if (settled) return
        runOnMain(deps, mainSessions, image, resolved, options).then(
          (cutout) => done(() => resolve(cutout)),
          (error) => done(() => reject(error)),
        )
      }

      if (!unusable) {
        try {
          worker ??= startWorker()
        } catch {
          unusable = true
        }
      }
      if (unusable || !worker) return viaMain()

      calls.set(id, { options, resolve: (cutout) => done(() => resolve(cutout)), reject: (error) => done(() => reject(error)), fallBack: viaMain })
      // a copy: the caller's pixels stay theirs (the copy is transferred to the worker)
      const copy = new Uint8ClampedArray(image.data.subarray(0, image.width * image.height * 4))
      const message: ToWorker = { type: 'run', run: id, ...resolved, pixels: copy.buffer as ArrayBuffer, width: image.width, height: image.height }
      try {
        worker.postMessage(message, [message.pixels])
      } catch {
        failWorker() // this call and any other that waits for the worker go to the main thread
      }
    })
  }
}

/** A model session on the main thread: shared by every call that needs it, with the callers that wait for its download (they all hear the progress). */
type MainEntry = { promise: Promise<SessionLike>; listeners: Set<(loaded: number, total: number) => void>; controller: AbortController; refs: number; ready: boolean; loaded: number; total: number }

/** Rejects with an AbortError as soon as `signal` aborts; otherwise gives `promise`'s result. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => (signal.removeEventListener('abort', onAbort), resolve(value)),
      (error) => (signal.removeEventListener('abort', onAbort), reject(error)),
    )
  })
}

/**
 * The same work on the main thread, in steps (the page can breathe between them). The model is downloaded once per page; the download belongs to everyone who waits
 * for it, not to the first caller: one caller's Cancel leaves the others alone, and the download is only stopped when nobody waits for it any more.
 */
async function runOnMain(deps: RemoverDeps, sessions: Map<string, MainEntry>, image: RgbaImage, resolved: { modelUrl: string; ortBase: string; modelBytes: number }, options: RemoveBackgroundOptions): Promise<Cutout> {
  const { signal, onProgress } = options
  const step = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  const alive = () => {
    if (signal?.aborted) throw abortError()
  }
  let entry = sessions.get(resolved.modelUrl)
  if (!entry) {
    const fresh: MainEntry = { promise: undefined as unknown as Promise<SessionLike>, listeners: new Set(), controller: new AbortController(), refs: 0, ready: false, loaded: 0, total: 0 }
    fresh.promise = downloadModel(
      resolved.modelUrl,
      resolved.modelBytes,
      (loaded, total) => {
        fresh.loaded = loaded
        fresh.total = total
        for (const listen of fresh.listeners) listen(loaded, total)
      },
      fresh.controller.signal,
    ).then(async (bytes) => {
      const created = await createSession(await deps.loadOrt(), bytes, resolved.ortBase)
      fresh.ready = true
      return created
    })
    sessions.set(resolved.modelUrl, fresh)
    fresh.promise.catch(() => {
      if (sessions.get(resolved.modelUrl) === fresh) sessions.delete(resolved.modelUrl) // a failed (or stopped) load is tried again on the next call
    })
    entry = fresh
  }
  const listener = (loaded: number, total: number) => onProgress?.({ stage: 'download', loaded, total })
  if (!entry.ready) {
    entry.listeners.add(listener)
    if (entry.loaded) listener(entry.loaded, entry.total) // joined a download that is under way
  }
  entry.refs++
  let created: SessionLike
  try {
    created = await abortable(entry.promise, signal)
  } catch (error) {
    if (signal?.aborted && !entry.ready && entry.refs === 1) {
      entry.controller.abort() // nobody else waits for this download
      if (sessions.get(resolved.modelUrl) === entry) sessions.delete(resolved.modelUrl)
    }
    throw error
  } finally {
    entry.refs--
    entry.listeners.delete(listener)
  }
  alive()
  onProgress?.({ stage: 'processing' })
  await step()
  alive()
  try {
    return await abortable(cutOut(await deps.loadOrt(), created, image), signal)
  } catch (error) {
    throw memoryError(error) ?? error
  }
}
