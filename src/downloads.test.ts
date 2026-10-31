import { afterEach, describe, expect, it, vi } from 'vitest'
import { announceDownload, canShareFiles, DOWNLOAD_EVENT, EACH_GAP_MS, saveBlob, saveEach, shareFiles } from './downloads.ts'

const files = [new File(['a'], 'a-1.jpg', { type: 'image/jpeg' }), new File(['b'], 'a-2.jpg', { type: 'image/jpeg' })]
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Counts `imginsta:download` events on window until the returned stop() is called. */
function listen() {
  const events: Event[] = []
  const on = (e: Event) => events.push(e)
  window.addEventListener('imginsta:download', on)
  return { events, stop: () => window.removeEventListener('imginsta:download', on) }
}
function stubSave() {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x/1'), revokeObjectURL: vi.fn() }))
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
}

describe('announceDownload', () => {
  it('the event is called imginsta:download', () => {
    expect(DOWNLOAD_EVENT).toBe('imginsta:download')
  })
  it('sends one CustomEvent on window, with no detail', () => {
    const l = listen()
    announceDownload()
    l.stop()
    expect(l.events).toHaveLength(1)
    expect(l.events[0]).toBeInstanceOf(CustomEvent)
    expect((l.events[0] as CustomEvent).detail).toBeNull()
  })
  it('does nothing and does not crash without a window (SSR, Node)', () => {
    vi.stubGlobal('window', undefined)
    expect(() => announceDownload()).not.toThrow()
  })
})

describe('saveBlob', () => {
  it('clicks a hidden download link with the name, removes it, and releases the URL later', () => {
    vi.useFakeTimers()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x/1'), revokeObjectURL: vi.fn() }))
    const clicks: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(`${this.download} ${this.getAttribute('href')}`)
    })
    saveBlob(new Blob(['x']), 'kurti-1.jpg')
    expect(clicks).toEqual(['kurti-1.jpg blob:x/1'])
    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x/1')
  })
  it('announces the download: one event per click', () => {
    stubSave()
    const l = listen()
    saveBlob(new Blob(['x']), 'a.jpg')
    expect(l.events).toHaveLength(1)
    saveBlob(new Blob(['y']), 'b.jpg')
    l.stop()
    expect(l.events).toHaveLength(2)
  })
})

describe('saveEach ("Download all separately")', () => {
  it('starts the downloads one after another, 300 ms apart', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const saved = vi.fn()
    const items = ['a', 'b', 'c'].map((n) => ({ blob: new Blob([n]), name: `${n}.jpg` }))
    saveEach(items, saved, save)
    expect(save.mock.calls.map((c) => c[0].name)).toEqual(['a.jpg'])
    vi.advanceTimersByTime(EACH_GAP_MS - 1)
    expect(save).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(save).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(EACH_GAP_MS)
    expect(save.mock.calls.map((c) => c[0].name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(saved.mock.calls.map((c) => c[0])).toEqual([0, 1, 2])
    vi.advanceTimersByTime(5 * EACH_GAP_MS)
    expect(save).toHaveBeenCalledTimes(3)
  })
  it('with the default save, n files announce n downloads', () => {
    vi.useFakeTimers()
    stubSave()
    const l = listen()
    const items = ['a', 'b', 'c'].map((n) => ({ blob: new Blob([n]), name: `${n}.jpg` }))
    saveEach(items, () => {})
    vi.advanceTimersByTime(5 * EACH_GAP_MS)
    l.stop()
    expect(l.events).toHaveLength(3)
  })
  it('cancel (new settings, new image, leaving): the rest is not downloaded', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const run = saveEach([1, 2, 3].map((n) => ({ blob: new Blob([]), name: `${n}` })), () => {}, save)
    run.cancel()
    vi.advanceTimersByTime(10 * EACH_GAP_MS)
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('share', () => {
  it('feature detection: only with canShare({ files }) true', () => {
    expect(canShareFiles(files, undefined)).toBe(false)
    expect(canShareFiles(files, {})).toBe(false) // desktop browsers without Web Share
    expect(canShareFiles(files, { share: vi.fn(), canShare: () => false })).toBe(false) // no file sharing
    expect(canShareFiles(files, { share: vi.fn(), canShare: () => true })).toBe(true)
    expect(canShareFiles([], { share: vi.fn(), canShare: () => true })).toBe(false)
    expect(canShareFiles(files, { share: vi.fn(), canShare: () => { throw new TypeError('x') } })).toBe(false)
    const canShare = vi.fn(() => true)
    canShareFiles(files, { share: vi.fn(), canShare })
    expect(canShare).toHaveBeenCalledWith({ files })
  })
  it('shares the files; the user closing the sheet (AbortError) is "cancelled", not an error', async () => {
    const share = vi.fn(async () => {})
    await expect(shareFiles(files, { share })).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({ files })
    await expect(shareFiles(files, { share: vi.fn(async () => Promise.reject(new DOMException('closed', 'AbortError'))) })).resolves.toBe('cancelled')
  })
  it('other failures are thrown (shown as a short message)', async () => {
    await expect(shareFiles(files, { share: vi.fn(async () => Promise.reject(new DOMException('no', 'NotAllowedError'))) })).rejects.toMatchObject({ name: 'NotAllowedError' })
    await expect(shareFiles(files, {})).rejects.toThrow('Web Share is not available')
  })
  it('announces the download only when the files were shared', async () => {
    const l = listen()
    await shareFiles(files, { share: vi.fn(async () => {}) })
    expect(l.events).toHaveLength(1)
    l.stop()
  })
  it('does not announce when the user cancels or sharing fails', async () => {
    const l = listen()
    await shareFiles(files, { share: vi.fn(async () => Promise.reject(new DOMException('closed', 'AbortError'))) })
    await expect(shareFiles(files, { share: vi.fn(async () => Promise.reject(new DOMException('no', 'NotAllowedError'))) })).rejects.toThrow()
    await expect(shareFiles(files, {})).rejects.toThrow()
    l.stop()
    expect(l.events).toHaveLength(0)
  })
})
