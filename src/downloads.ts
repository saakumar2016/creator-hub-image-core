// Getting files out of the browser: one file, several files one after another,
// and the phone's share sheet. Object URLs made here are released shortly after their click.

export type Item = { blob: Blob; name: string }

/** Starts the download of one blob under `name`; its object URL is released after `keep` ms. */
export function saveBlob(blob: Blob, name: string, doc: Document = document, keep = 2000) {
  const url = URL.createObjectURL(blob)
  const a = doc.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  a.style.display = 'none'
  doc.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), keep)
}

/** The gap between the downloads of "Download all separately". */
export const EACH_GAP_MS = 300

/**
 * "Download all N separately": the downloads start one after another, EACH_GAP_MS apart (browsers
 * ask once to allow multiple downloads). `onSaved(k)` follows each one; `cancel()` stops the rest.
 */
export function saveEach(items: readonly Item[], onSaved: (k: number) => void, save: (item: Item) => void = (i) => saveBlob(i.blob, i.name)) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const next = (k: number) => {
    if (stopped || k >= items.length) return
    save(items[k])
    onSaved(k)
    timer = setTimeout(() => next(k + 1), EACH_GAP_MS)
  }
  next(0)
  return {
    cancel: () => {
      stopped = true
      clearTimeout(timer)
    },
  }
}

type ShareNavigator = Pick<Navigator, 'canShare' | 'share'>
const browserNavigator = () => (typeof navigator === 'undefined' ? undefined : (navigator as Partial<ShareNavigator>))

/**
 * True only when the browser can share these files (MDN: `navigator.canShare({ files })`; it is
 * missing where Web Share is not supported, and false without file support or permission).
 */
export function canShareFiles(files: readonly File[], nav: Partial<ShareNavigator> | undefined = browserNavigator()): boolean {
  if (!files.length || typeof nav?.canShare !== 'function' || typeof nav.share !== 'function') return false
  try {
    return nav.canShare({ files: [...files] })
  } catch {
    return false
  }
}

/**
 * Opens the share sheet with the files. Must run directly in the click handler (transient
 * activation). The user closing the sheet (AbortError) is not an error: 'cancelled'.
 */
export async function shareFiles(files: readonly File[], nav: Partial<ShareNavigator> | undefined = browserNavigator()): Promise<'shared' | 'cancelled'> {
  if (!nav?.share) throw new Error('Web Share is not available')
  try {
    await nav.share({ files: [...files] })
    return 'shared'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    throw error
  }
}
