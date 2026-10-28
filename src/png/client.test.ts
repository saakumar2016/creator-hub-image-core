// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { compressPngWith, type WorkerLike } from './client.ts'
import { photoLike } from './fixtures.ts'
import type { WorkerRequest, WorkerResponse } from './protocol.ts'
import { PNG_MAX_PIXELS, PngCompressError, PngTooLargeError } from './types.ts'

// The main-thread side with a fake worker; the real worker is checked in a browser (README, "PNG compress").
function fakeWorker(reply: (request: WorkerRequest, worker: WorkerLike) => void) {
  const worker: WorkerLike & { terminated: number; requests: WorkerRequest[] } = {
    terminated: 0,
    requests: [],
    onmessage: null,
    onerror: null,
    postMessage(message) {
      worker.requests.push(message)
      queueMicrotask(() => reply(message, worker))
    },
    terminate() {
      worker.terminated++
    },
  }
  return worker
}
const say = (worker: WorkerLike, data: WorkerResponse) => worker.onmessage?.({ data } as MessageEvent<WorkerResponse>)
const PNG_BYTES = new Uint8Array([137, 80, 78, 71]).buffer

describe('compressPngWith', () => {
  it('sends a COPY of the pixels and the options, passes progress on, resolves with a PNG blob and ends the worker once', async () => {
    const image = photoLike(8, 8)
    const onProgress = vi.fn()
    const worker = fakeWorker((_request, w) => {
      say(w, { type: 'progress', progress: { stage: 'quantize', colors: 256 } })
      say(w, { type: 'done', bytes: PNG_BYTES, colors: 128, reachedTarget: true })
    })
    const result = await compressPngWith(() => worker, 'https://remote.example/oxipng.wasm', image, { targetBytes: 5000, minColors: 128, level: 1, onProgress })
    expect(result.blob.type).toBe('image/png')
    expect([result.bytes, result.colors, result.reachedTarget]).toEqual([4, 128, true])
    expect(onProgress).toHaveBeenCalledWith({ stage: 'quantize', colors: 256 })
    expect(worker.terminated).toBe(1)
    const request = worker.requests[0]
    expect(request.wasmUrl).toBe('https://remote.example/oxipng.wasm')
    expect(request.options).toEqual({ targetBytes: 5000, minColors: 128, level: 1 })
    expect(request.image.data).not.toBe(image.data.buffer)
    expect(image.data.byteLength).toBe(8 * 8 * 4) // the caller's pixels are untouched (not detached)
  })

  it('an error message from the worker becomes a PngCompressError', async () => {
    const worker = fakeWorker((_r, w) => say(w, { type: 'error', name: 'Error', message: 'wasm failed' }))
    await expect(compressPngWith(() => worker, 'u', photoLike(8, 8))).rejects.toMatchObject({ name: 'PngCompressError', message: 'wasm failed' })
    expect(worker.terminated).toBe(1)
  })

  it('a worker error event and a worker that cannot start become a PngCompressError', async () => {
    const worker = fakeWorker((_r, w) => w.onerror?.({ message: 'boom' } as ErrorEvent))
    await expect(compressPngWith(() => worker, 'u', photoLike(8, 8))).rejects.toBeInstanceOf(PngCompressError)
    await expect(compressPngWith(() => { throw new Error('no worker') }, 'u', photoLike(8, 8))).rejects.toBeInstanceOf(PngCompressError)
  })

  it('an abort terminates the worker and rejects with an AbortError; an already aborted signal never starts one', async () => {
    const controller = new AbortController()
    const worker = fakeWorker(() => {})
    const pending = compressPngWith(() => worker, 'u', photoLike(8, 8), { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(1)
    const spawn = vi.fn()
    await expect(compressPngWith(spawn, 'u', photoLike(8, 8), { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('a message after the abort or the end is ignored (no second settle, no second terminate)', async () => {
    const worker = fakeWorker((_r, w) => { say(w, { type: 'done', bytes: PNG_BYTES, colors: 64, reachedTarget: false }); say(w, { type: 'done', bytes: PNG_BYTES, colors: 64, reachedTarget: false }) })
    await compressPngWith(() => worker, 'u', photoLike(8, 8))
    expect(worker.terminated).toBe(1)
  })

  it(`more than ${PNG_MAX_PIXELS} pixels throws PngTooLargeError before any worker starts`, () => {
    const spawn = vi.fn()
    const huge = { data: new Uint8ClampedArray(4), width: 4000, height: 3001 } // 12,004,000 px
    expect(() => compressPngWith(spawn, 'u', huge)).toThrow(PngTooLargeError)
    expect(() => compressPngWith(spawn, 'u', huge)).toThrow(/limited to 12000000/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('exactly the limit is allowed; a buffer that is too short or an empty size is a RangeError', () => {
    expect(() => compressPngWith(() => fakeWorker(() => {}), 'u', { data: new Uint8ClampedArray(8), width: 4000, height: 3000 })).toThrow(RangeError)
    expect(() => compressPngWith(() => fakeWorker(() => {}), 'u', { data: new Uint8ClampedArray(0), width: 0, height: 5 })).toThrow(RangeError)
    expect(() => compressPngWith(() => fakeWorker(() => {}), 'u', photoLike(8, 8), { minColors: 32 as 64 })).toThrow(RangeError)
  })
})
