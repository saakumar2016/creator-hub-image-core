// The PNG worker: runs the ladder (core.ts) on the pixels it is sent. One run per worker; the main thread terminates it afterwards.
/// <reference lib="webworker" />
import { runLadder } from './core.ts'
import { createEngine } from './engine.ts'
import type { WorkerRequest, WorkerResponse } from './protocol.ts'

const send = (message: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer)

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { image, options, wasmUrl } = event.data
  try {
    // Compiled from a URL the main thread made absolute (the remote's origin when the tool runs inside the shell; the server needs CORS and application/wasm).
    const response = await fetch(wasmUrl)
    if (!response.ok) throw new Error(`The oxipng wasm file could not be loaded (HTTP ${response.status})`)
    const engine = await createEngine(await WebAssembly.compileStreaming(response))
    const result = await runLadder({ data: new Uint8ClampedArray(image.data), width: image.width, height: image.height }, options, engine, {
      onProgress: (progress) => send({ type: 'progress', progress }),
    })
    const bytes = result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength) as ArrayBuffer
    send({ type: 'done', bytes, colors: result.colors, reachedTarget: result.reachedTarget }, [bytes])
  } catch (error) {
    send({ type: 'error', name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) })
  }
}
