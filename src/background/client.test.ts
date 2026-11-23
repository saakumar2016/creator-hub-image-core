import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRemover, type WorkerLike } from './client.ts'
import { finish } from './core.ts'
import type { FromWorker, ToWorker } from './protocol.ts'
import { discMask, discPhoto, fakeOrt, RED } from './fixtures.ts'
import { BackgroundError, BackgroundModelError, defaultOrtBase, ORT_VERSION, type BackgroundProgress } from './types.ts'

const MODEL = 'https://tools.example/models/u2netp.309c8469.onnx'
const photo = discPhoto(300, 200)
const alphaAt = (c: { data: Uint8ClampedArray; width: number }, x: number, y: number) => c.data[(y * c.width + x) * 4 + 3]

/** A fake worker that answers like worker.ts: a download, then "working", then the cut-out of the photo (made with the same core code). `mode` changes what it does. */
function fakeWorkers(mode: () => 'ok' | 'silent' | 'model-error' | 'crash' = () => 'ok') {
  const made: Fake[] = []
  class Fake implements WorkerLike {
    onmessage: WorkerLike['onmessage'] = null
    onerror: WorkerLike['onerror'] = null
    terminated = false
    requests: ToWorker[] = []
    postMessage(message: ToWorker) {
      this.requests.push(message)
      const send = (data: FromWorker) => queueMicrotask(() => this.onmessage?.({ data } as MessageEvent<FromWorker>))
      const m = mode()
      if (m === 'silent') return
      if (m === 'crash') return void queueMicrotask(() => this.onerror?.({ message: 'blocked' } as ErrorEvent))
      if (m === 'model-error') return send({ type: 'error', run: message.run, kind: 'model', message: 'Could not load the model (status 404)' })
      send({ type: 'download', run: message.run, loaded: 1000, total: 4000 })
      send({ type: 'working', run: message.run })
      const source = { data: new Uint8ClampedArray(message.pixels), width: message.width, height: message.height }
      const cutout = finish(source, discMask(message.width, message.height))
      send({ type: 'done', run: message.run, pixels: cutout.data.buffer as ArrayBuffer, width: cutout.width, height: cutout.height })
    }
    terminate() {
      this.terminated = true
    }
  }
  return { made, spawn: () => { const w = new Fake(); made.push(w); return w } }
}

beforeEach(() => vi.useRealTimers())
afterEach(() => vi.unstubAllGlobals())

describe('the worker path', () => {
  it('sends the photo, passes the progress on (download bytes, then processing) and returns the cut-out at the photo\'s size', async () => {
    const workers = fakeWorkers()
    const remove = createRemover({ spawn: workers.spawn, loadOrt: async () => fakeOrt().ort })
    const seen: BackgroundProgress[] = []
    const cutout = await remove(photo, { modelUrl: MODEL, modelBytes: 4000, onProgress: (p) => seen.push(p) })
    expect(seen).toEqual([{ stage: 'download', loaded: 1000, total: 4000 }, { stage: 'processing' }])
    expect([cutout.width, cutout.height]).toEqual([300, 200])
    expect(alphaAt(cutout, 150, 100)).toBe(255)
    expect(alphaAt(cutout, 2, 2)).toBe(0)
    expect(workers.made[0].requests[0]).toMatchObject({ type: 'run', modelUrl: MODEL, modelBytes: 4000, ortBase: `https://tools.example/ort/${ORT_VERSION}/`, width: 300, height: 200 })
  })
  it('does not detach or change the caller\'s pixels (a copy goes to the worker)', async () => {
    const workers = fakeWorkers()
    const remove = createRemover({ spawn: workers.spawn, loadOrt: async () => fakeOrt().ort })
    const before = [...photo.data.slice(0, 40)]
    await remove(photo, { modelUrl: MODEL })
    expect(photo.data.length).toBe(300 * 200 * 4)
    expect([...photo.data.slice(0, 40)]).toEqual(before)
  })
  it('one worker for all calls (so the model is loaded once), and it is kept after a call', async () => {
    const workers = fakeWorkers()
    const remove = createRemover({ spawn: workers.spawn, loadOrt: async () => fakeOrt().ort })
    await remove(photo, { modelUrl: MODEL })
    await remove(photo, { modelUrl: MODEL })
    expect(workers.made).toHaveLength(1)
    expect(workers.made[0].requests).toHaveLength(2)
    expect(workers.made[0].terminated).toBe(false)
  })
  it('a custom ortBase and its trailing slash', async () => {
    const workers = fakeWorkers()
    const remove = createRemover({ spawn: workers.spawn, loadOrt: async () => fakeOrt().ort })
    await remove(photo, { modelUrl: MODEL, ortBase: 'https://cdn.example/runtime' })
    expect(workers.made[0].requests[0].ortBase).toBe('https://cdn.example/runtime/')
    expect(defaultOrtBase('https://a.example/x/y.onnx')).toBe(`https://a.example/ort/${ORT_VERSION}/`)
  })
  it('Cancel: aborting while it works rejects with an AbortError and ends the worker (nobody else waits)', async () => {
    const workers = fakeWorkers(() => 'silent')
    const remove = createRemover({ spawn: workers.spawn, loadOrt: async () => fakeOrt().ort })
    const controller = new AbortController()
    const waiting = remove(photo, { modelUrl: MODEL, signal: controller.signal })
    await Promise.resolve()
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    expect(workers.made[0].terminated).toBe(true)
    // the next call starts a new worker
    const again = fakeWorkers()
    void again
    const second = remove(photo, { modelUrl: MODEL })
    expect(workers.made).toHaveLength(2)
    void second.catch(() => undefined)
  })
  it('Cancel: an already aborted signal never starts anything', async () => {
    const workers = fakeWorkers()
    const remove = createRemover({ spawn: workers.spawn, loadOrt: async () => fakeOrt().ort })
    const controller = new AbortController()
    controller.abort()
    await expect(remove(photo, { modelUrl: MODEL, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(workers.made).toHaveLength(0)
  })
  it('Cancel of one call does not end the worker while another call waits', async () => {
    const workers = fakeWorkers(() => 'silent')
    const remove = createRemover({ spawn: workers.spawn, loadOrt: async () => fakeOrt().ort })
    const a = new AbortController()
    const first = remove(photo, { modelUrl: MODEL, signal: a.signal })
    const second = remove(photo, { modelUrl: MODEL })
    void second.catch(() => undefined)
    a.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(workers.made[0].terminated).toBe(false)
  })
  it('a model that cannot be loaded is a BackgroundModelError with the reason', async () => {
    const workers = fakeWorkers(() => 'model-error')
    const remove = createRemover({ spawn: workers.spawn, loadOrt: async () => fakeOrt().ort })
    const error = await remove(photo, { modelUrl: MODEL }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BackgroundModelError)
    expect((error as Error).message).toContain('status 404')
  })
})

describe('wrong options are clear errors', () => {
  const remove = createRemover({ spawn: fakeWorkers().spawn, loadOrt: async () => fakeOrt().ort })
  it('a missing or relative modelUrl', async () => {
    for (const modelUrl of ['', '/models/u2netp.onnx', 'models/x.onnx', 'not a url'])
      await expect(remove(photo, { modelUrl }), modelUrl).rejects.toThrow(/modelUrl/)
    await expect(remove(photo, {} as never)).rejects.toBeInstanceOf(BackgroundModelError)
    await expect(remove(photo, { modelUrl: '' })).rejects.toBeInstanceOf(BackgroundModelError)
  })
  it('a bad modelBytes', async () => {
    await expect(remove(photo, { modelUrl: MODEL, modelBytes: -1 })).rejects.toBeInstanceOf(RangeError)
  })
})

describe('the main-thread fallback (no worker, or a worker that fails)', () => {
  const modelBytes = new Uint8Array(4000).fill(7)
  const stubFetch = (handler: (url: string, signal?: AbortSignal) => Response | Promise<Response>) => {
    const fetchMock = vi.fn(async (url: string, init?: { signal?: AbortSignal }) => handler(url, init?.signal))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }
  const noWorker = () => { throw new Error('Workers are not available') }

  it('downloads the model once, makes the session once, and the second photo reuses both ("model ek hi baar load")', async () => {
    const fetchMock = stubFetch(() => new Response(modelBytes, { headers: { 'Content-Length': '4000' } }))
    const { ort, created, runs } = fakeOrt(300, 200)
    const remove = createRemover({ spawn: noWorker, loadOrt: async () => ort })
    const seen: BackgroundProgress[] = []
    const first = await remove(photo, { modelUrl: MODEL, onProgress: (p) => seen.push(p) })
    const second = await remove(photo, { modelUrl: MODEL })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(created.count).toBe(1)
    expect(runs.count).toBe(2)
    expect(seen[0]).toMatchObject({ stage: 'download' })
    expect(seen.at(-1)).toEqual({ stage: 'processing' })
    expect(seen.filter((p) => p.stage === 'download').at(-1)).toEqual({ stage: 'download', loaded: 4000, total: 4000 })
    for (const cutout of [first, second]) {
      expect(cutout.data.slice((100 * 300 + 150) * 4, (100 * 300 + 150) * 4 + 4)).toEqual(new Uint8ClampedArray([...RED, 255]))
      expect(alphaAt(cutout, 1, 1)).toBe(0)
    }
    expect(ort.env.wasm.wasmPaths).toBe(`https://tools.example/ort/${ORT_VERSION}/`)
    expect(ort.env.wasm.numThreads).toBe(1)
  })
  it('a worker that fails to run hands the photo to the main thread', async () => {
    stubFetch(() => new Response(modelBytes))
    const workers = fakeWorkers(() => 'crash')
    const { ort } = fakeOrt(300, 200)
    const remove = createRemover({ spawn: workers.spawn, loadOrt: async () => ort })
    const cutout = await remove(photo, { modelUrl: MODEL })
    expect(alphaAt(cutout, 150, 100)).toBe(255)
    expect(workers.made[0].terminated).toBe(true)
    await remove(photo, { modelUrl: MODEL }) // from now on the main thread; no second worker
    expect(workers.made).toHaveLength(1)
  })
  it('a wrong model URL (404) is a clear BackgroundModelError that names the URL and the status', async () => {
    stubFetch(() => new Response('not found', { status: 404 }))
    const remove = createRemover({ spawn: noWorker, loadOrt: async () => fakeOrt().ort })
    const error = await remove(photo, { modelUrl: MODEL }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BackgroundModelError)
    expect((error as Error).message).toContain(MODEL)
    expect((error as Error).message).toContain('404')
  })
  it('a model URL that cannot be reached (network error) is a BackgroundModelError', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const remove = createRemover({ spawn: noWorker, loadOrt: async () => fakeOrt().ort })
    await expect(remove(photo, { modelUrl: MODEL })).rejects.toBeInstanceOf(BackgroundModelError)
  })
  it('a file that is not an ONNX model (an HTML page served with 200) is a BackgroundModelError, not a crash', async () => {
    stubFetch(() => new Response('<html>404</html>'))
    const { ort } = fakeOrt()
    ort.InferenceSession.create = async () => { throw new Error('failed to parse protobuf: invalid wire type') }
    const remove = createRemover({ spawn: noWorker, loadOrt: async () => ort })
    const error = await remove(photo, { modelUrl: MODEL }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BackgroundModelError)
    expect((error as Error).message).toMatch(/not a valid ONNX model/)
  })
  it('the runtime files missing (wasm not served) is a BackgroundError that says where they must be', async () => {
    stubFetch(() => new Response(modelBytes))
    const { ort } = fakeOrt()
    ort.InferenceSession.create = async () => { throw new Error('failed to fetch dynamically imported module') }
    const remove = createRemover({ spawn: noWorker, loadOrt: async () => ort })
    const error = await remove(photo, { modelUrl: MODEL }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BackgroundError)
    expect(error).not.toBeInstanceOf(BackgroundModelError)
    expect((error as Error).message).toContain(`https://tools.example/ort/${ORT_VERSION}/`)
  })
  it('a failed load is tried again on the next call (it is not cached)', async () => {
    let ok = false
    const fetchMock = stubFetch(() => (ok ? new Response(modelBytes) : new Response('', { status: 503 })))
    const remove = createRemover({ spawn: noWorker, loadOrt: async () => fakeOrt(300, 200).ort })
    await expect(remove(photo, { modelUrl: MODEL })).rejects.toBeInstanceOf(BackgroundModelError)
    ok = true
    const cutout = await remove(photo, { modelUrl: MODEL })
    expect(alphaAt(cutout, 150, 100)).toBe(255)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('Cancel during the download rejects with an AbortError (the request is aborted)', async () => {
    stubFetch((_url, signal) => new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
    const remove = createRemover({ spawn: noWorker, loadOrt: async () => fakeOrt().ort })
    const controller = new AbortController()
    const waiting = remove(photo, { modelUrl: MODEL, signal: controller.signal })
    await new Promise((r) => setTimeout(r, 5))
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('Cancel after the model is ready (while the photo works) also rejects with an AbortError', async () => {
    stubFetch(() => new Response(modelBytes))
    const { ort } = fakeOrt(300, 200)
    const controller = new AbortController()
    const remove = createRemover({ spawn: noWorker, loadOrt: async () => ort })
    const waiting = remove(photo, { modelUrl: MODEL, signal: controller.signal, onProgress: (p) => { if (p.stage === 'processing') controller.abort() } })
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
  })
})
