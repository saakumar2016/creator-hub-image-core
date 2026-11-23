// The background worker (bundled inline into the entry by index.ts: a Worker cannot be created from a remote's URL inside another origin's page). It
// downloads the model once (the session is kept for the next photo), runs it with onnxruntime-web (CPU wasm, one thread) and answers with the cut-out.
// It touches nothing but the two URLs it is given. The session is kept per model URL: the first call's `ortBase` and `modelBytes` decide.
import * as ort from 'onnxruntime-web/wasm'
import { cutOut, createSession, downloadModel, memoryError, type OrtLike, type SessionLike } from './engine.ts'
import { BackgroundModelError } from './types.ts'
import type { FromWorker, ToWorker } from './protocol.ts'

type Scope = { onmessage: ((event: MessageEvent<ToWorker>) => void) | null; postMessage(message: FromWorker, transfer?: Transferable[]): void }
const scope = self as unknown as Scope

/** One model: its session once loaded, and the calls that are waiting for it (they all hear the download's progress, not only the first). */
type Entry = { promise: Promise<SessionLike>; runs: Set<number>; loaded: number; total: number; ready: boolean }
const sessions = new Map<string, Entry>()

async function run(message: ToWorker): Promise<void> {
  const { run: id, modelUrl, ortBase, modelBytes } = message
  let entry = sessions.get(modelUrl)
  if (!entry) {
    const fresh: Entry = { promise: undefined as unknown as Promise<SessionLike>, runs: new Set(), loaded: 0, total: 0, ready: false }
    fresh.promise = downloadModel(modelUrl, modelBytes, (loaded, total) => {
      fresh.loaded = loaded
      fresh.total = total
      for (const waiting of fresh.runs) scope.postMessage({ type: 'download', run: waiting, loaded, total })
    }).then(async (bytes) => {
      const made = await createSession(ort as unknown as OrtLike, bytes, ortBase)
      fresh.ready = true
      return made
    })
    sessions.set(modelUrl, fresh)
    fresh.promise.catch(() => sessions.delete(modelUrl)) // a failed load is tried again on the next call
    entry = fresh
  } else if (!entry.ready && entry.loaded) scope.postMessage({ type: 'download', run: id, loaded: entry.loaded, total: entry.total }) // joined a download that is under way
  entry.runs.add(id)
  let created: SessionLike
  try {
    created = await entry.promise
  } finally {
    entry.runs.delete(id)
  }
  scope.postMessage({ type: 'working', run: id })
  const cutout = await cutOut(ort as unknown as OrtLike, created, { data: new Uint8ClampedArray(message.pixels), width: message.width, height: message.height })
  scope.postMessage({ type: 'done', run: id, pixels: cutout.data.buffer as ArrayBuffer, width: cutout.width, height: cutout.height }, [cutout.data.buffer as ArrayBuffer])
}

scope.onmessage = (event) => {
  const message = event.data
  if (message.type !== 'run') return
  run(message).catch((error: unknown) => {
    const e = memoryError(error) ?? (error instanceof Error ? error : new Error(String(error)))
    scope.postMessage({ type: 'error', run: message.run, kind: e instanceof BackgroundModelError ? 'model' : 'other', message: e.message })
  })
}
