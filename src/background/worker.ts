// The background worker (bundled inline into the entry by index.ts: a Worker cannot be created from a remote's URL inside another origin's page). It
// downloads the model once (the session is kept for the next photo), runs it with onnxruntime-web (CPU wasm, one thread) and answers with the cut-out.
// It touches nothing but the two URLs it is given.
import * as ort from 'onnxruntime-web/wasm'
import { cutOut, createSession, downloadModel, type OrtLike, type SessionLike } from './engine.ts'
import { BackgroundModelError } from './types.ts'
import type { FromWorker, ToWorker } from './protocol.ts'

type Scope = { onmessage: ((event: MessageEvent<ToWorker>) => void) | null; postMessage(message: FromWorker, transfer?: Transferable[]): void }
const scope = self as unknown as Scope

const sessions = new Map<string, Promise<SessionLike>>()

async function run(message: ToWorker): Promise<void> {
  const { run: id, modelUrl, ortBase, modelBytes } = message
  let session = sessions.get(modelUrl)
  if (!session) {
    session = downloadModel(modelUrl, modelBytes, (loaded, total) => scope.postMessage({ type: 'download', run: id, loaded, total })).then((bytes) => createSession(ort as unknown as OrtLike, bytes, ortBase))
    sessions.set(modelUrl, session)
    session.catch(() => sessions.delete(modelUrl)) // a failed load is tried again on the next call
  }
  const created = await session
  scope.postMessage({ type: 'working', run: id })
  const cutout = await cutOut(ort as unknown as OrtLike, created, { data: new Uint8ClampedArray(message.pixels), width: message.width, height: message.height })
  scope.postMessage({ type: 'done', run: id, pixels: cutout.data.buffer as ArrayBuffer, width: cutout.width, height: cutout.height }, [cutout.data.buffer as ArrayBuffer])
}

scope.onmessage = (event) => {
  const message = event.data
  if (message.type !== 'run') return
  run(message).catch((error: unknown) => {
    const e = error instanceof Error ? error : new Error(String(error))
    scope.postMessage({ type: 'error', run: message.run, kind: e instanceof BackgroundModelError ? 'model' : 'other', message: e.message })
  })
}
