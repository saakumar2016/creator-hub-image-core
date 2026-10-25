// A small PDF writer for "PDF" output: one JPEG image per page, the image drawn on the whole page.
// The JPEG bytes are embedded unchanged (/Filter /DCTDecode): nothing is decoded or re-encoded.
// Structure (PDF 1.4, ISO 32000-1): header, per page a page object, an image XObject and a content
// stream, then the page tree, the catalog, a classic cross-reference table with exact byte offsets,
// the trailer and %%EOF. No document information, no metadata, no dates, no producer string.
//
// Supported JPEG input: baseline DCT (SOF0), Huffman coding, 8 bits per sample, 1 component
// (DeviceGray) or 3 components (DeviceRGB). Not supported, with an error: extended sequential
// (SOF1), progressive (SOF2), arithmetic coding, lossless, 12-bit, and 4-component (CMYK / YCCK) files.

export class PdfError extends Error {}

export const PDF_MIME = 'application/pdf'
/** The page size limit of PDF 1.4 readers: 14,400 points (200 in) per side. */
export const MAX_PAGE_PT = 14400

export type JpegInfo = { width: number; height: number; components: 1 | 3 }

export type PdfPage = {
  /** A JPEG file (see the supported kinds above). */
  jpeg: Uint8Array
  /** The JPEG's size in pixels: must match what `parseJpegSize` reads from the file. */
  widthPx: number
  heightPx: number
  /** The page (MediaBox) in points, 1 pt = 1/72 in. The image fills it. */
  pageWidthPt: number
  pageHeightPt: number
}

/** Millimetres to points (1 pt = 1/72 in), rounded to 0.001 pt so that 152.4 mm is exactly 432 pt. */
export const mmToPt = (mm: number): number => Math.round((mm / 25.4) * 72 * 1000) / 1000

/** Pixels at `dpi` to points; `dpi` defaults to 96 (a CSS pixel). */
export const pxToPt = (px: number, dpi = 96): number => Math.round((px / dpi) * 72 * 1000) / 1000

// SOF markers: only 0xC0 (baseline) is supported; the others are named for the error.
const BASELINE = 0xc0
const SOF_NAMES: Record<number, string> = { 0xc1: 'extended sequential', 0xc2: 'progressive', 0xc3: 'lossless', 0xc5: 'differential', 0xc6: 'differential progressive', 0xc7: 'differential lossless', 0xc9: 'arithmetic-coded', 0xca: 'arithmetic-coded progressive', 0xcb: 'arithmetic-coded lossless', 0xcd: 'differential arithmetic-coded', 0xce: 'differential arithmetic-coded progressive', 0xcf: 'differential arithmetic-coded lossless' }

/**
 * Reads the size and the number of components from the start-of-frame segment of a JPEG file.
 * Throws PdfError for anything that is not a JPEG of a supported kind.
 */
export function parseJpegSize(bytes: Uint8Array): JpegInfo {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new PdfError('Not a JPEG file (it does not start with the SOI marker)')
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) throw new PdfError('Damaged JPEG file (a marker was expected)')
    const marker = bytes[at + 1]
    if (marker === 0xff) {
      at++ // fill byte before a marker
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2 // markers without a length
      continue
    }
    if (marker === 0xd9 || marker === 0xda) break // end of image / start of scan before any frame header
    const length = (bytes[at + 2] << 8) | bytes[at + 3]
    if (length < 2 || at + 2 + length > bytes.length) throw new PdfError('Damaged JPEG file (a segment is cut off)')
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (marker !== BASELINE) throw new PdfError(`Unsupported JPEG: ${SOF_NAMES[marker] ?? 'unknown coding'}; only baseline JPEGs are supported`)
      // The frame header is 8 bytes plus 3 per component, and all of it must be in the file.
      if (length < 8) throw new PdfError('Damaged JPEG file (the frame header is too short)')
      const components = bytes[at + 9]
      if (length !== 8 + 3 * components) throw new PdfError('Damaged JPEG file (the frame header has the wrong length)')
      const precision = bytes[at + 4]
      const height = (bytes[at + 5] << 8) | bytes[at + 6]
      const width = (bytes[at + 7] << 8) | bytes[at + 8]
      if (precision !== 8) throw new PdfError(`Unsupported JPEG: ${precision}-bit samples; only 8-bit JPEGs are supported`)
      if (width === 0 || height === 0) throw new PdfError('Unsupported JPEG: the size is 0 (a height set after the scan is not supported)')
      if (components !== 1 && components !== 3) throw new PdfError(`Unsupported JPEG: ${components} components; only grayscale (1) and colour (3) JPEGs are supported, not CMYK`)
      return { width, height, components }
    }
    at += 2 + length
  }
  throw new PdfError('Damaged JPEG file (no frame header found)')
}

// ---- Text parts of the file (all ASCII) ----

/** A number as PDF writes it: plain decimal, at most 3 decimals, no exponent. */
function num(value: number): string {
  const text = value.toFixed(3)
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}
const ascii = (text: string): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i)
  return out
}

const HEADER = Uint8Array.from([...ascii('%PDF-1.4\n'), 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]) // the second line marks the file as binary

/** Object numbers: 1 catalog, 2 page tree, then 3 objects per page (page, image, content stream). */
const pageId = (index: number) => 3 + 3 * index
const imageId = (index: number) => 4 + 3 * index
const contentId = (index: number) => 5 + 3 * index

const object = (id: number, body: string) => `${id} 0 obj\n${body}\nendobj\n`
const streamHead = (id: number, dictionary: string, length: number) => `${id} 0 obj\n<< ${dictionary ? `${dictionary} ` : ''}/Length ${length} >>\nstream\n`
const STREAM_TAIL = '\nendstream\nendobj\n'

const catalog = () => object(1, '<< /Type /Catalog /Pages 2 0 R >>')
const pageTree = (count: number) => object(2, `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${count} >>`)
const pageObject = (index: number, widthPt: number, heightPt: number) =>
  object(pageId(index), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(widthPt)} ${num(heightPt)}] /Resources << /XObject << /Im0 ${imageId(index)} 0 R >> >> /Contents ${contentId(index)} 0 R >>`)
const imageDictionary = (width: number, height: number, components: 1 | 3) => `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /${components === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode`
const contentStream = (widthPt: number, heightPt: number) => `q ${num(widthPt)} 0 0 ${num(heightPt)} 0 0 cm /Im0 Do Q`

const xrefEntry = (offset: number) => `${String(offset).padStart(10, '0')} 00000 n \n`

const checkPage = (page: PdfPage, index: number): JpegInfo => {
  const where = `Page ${index + 1}`
  const info = parseJpegSize(page.jpeg)
  if (info.width !== page.widthPx || info.height !== page.heightPx) throw new PdfError(`${where}: the JPEG is ${info.width} × ${info.height} px, not ${page.widthPx} × ${page.heightPx}`)
  for (const [name, value] of [['pageWidthPt', page.pageWidthPt], ['pageHeightPt', page.pageHeightPt]] as const) {
    if (!Number.isFinite(value) || value <= 0 || value > MAX_PAGE_PT) throw new PdfError(`${where}: ${name} must be above 0 and at most ${MAX_PAGE_PT} pt`)
  }
  return info
}

/** The PDF as parts for a Blob (`new Blob(pdfStore(...), { type: PDF_MIME })`). */
export function pdfStore(pages: readonly PdfPage[]): Uint8Array<ArrayBuffer>[] {
  if (pages.length === 0) throw new PdfError('A PDF needs at least one page')
  const infos = pages.map(checkPage)
  const parts: Uint8Array<ArrayBuffer>[] = []
  const offsets: number[] = [] // offsets[n] = byte position of "n 0 obj" (index 0 unused)
  let position = 0
  const add = (part: Uint8Array<ArrayBuffer> | string) => {
    const bytes = typeof part === 'string' ? ascii(part) : part
    parts.push(bytes)
    position += bytes.length
  }
  const start = (id: number) => (offsets[id] = position)

  add(HEADER as Uint8Array<ArrayBuffer>)
  start(1)
  add(catalog())
  start(2)
  add(pageTree(pages.length))
  pages.forEach((page, index) => {
    start(pageId(index))
    add(pageObject(index, page.pageWidthPt, page.pageHeightPt))
    start(imageId(index))
    add(streamHead(imageId(index), imageDictionary(page.widthPx, page.heightPx, infos[index].components), page.jpeg.length))
    add(page.jpeg as Uint8Array<ArrayBuffer>)
    add(STREAM_TAIL)
    const content = contentStream(page.pageWidthPt, page.pageHeightPt)
    start(contentId(index))
    add(streamHead(contentId(index), '', content.length) + content + STREAM_TAIL)
  })

  const size = 3 + 3 * pages.length // objects 0 … size - 1
  const xrefAt = position
  add(`xref\n0 ${size}\n0000000000 65535 f \n`)
  for (let id = 1; id < size; id++) add(xrefEntry(offsets[id]))
  add(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`)
  return parts
}

/** A PDF with one image per page (MIME application/pdf). */
export function writePdf(pages: readonly PdfPage[]): Blob {
  return new Blob(pdfStore(pages), { type: PDF_MIME })
}

/**
 * Bytes a PDF adds to the JPEG data: an upper bound for any pages within the limits above (page
 * sizes up to 14,400 pt (numbers of at most 9 characters, 3 decimals), images up to 65,535 px, JPEG
 * data up to 9,999,999,999 bytes). A tool that must stay under a size limit subtracts this from the limit: the real overhead
 * is at most this and, for ordinary sizes, within a few dozen bytes of it per page.
 */
export function estimatePdfOverhead(pageCount: number): number {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new PdfError('The page count must be a whole number of at least 1')
  // The longest MediaBox number a page can have is 9 characters (for example 14399.999).
  const w = 14400.999 // the same width, so it is a safe stand-in
  const size = 3 + 3 * pageCount
  let total = HEADER.length + catalog().length + pageTree(pageCount).length
  for (let index = 0; index < pageCount; index++) {
    const content = contentStream(w, w)
    total += pageObject(index, w, w).length
    total += streamHead(imageId(index), imageDictionary(65535, 65535, 3), 9_999_999_999).length + STREAM_TAIL.length
    total += streamHead(contentId(index), '', content.length).length + content.length + STREAM_TAIL.length
  }
  const xref = `xref\n0 ${size}\n0000000000 65535 f \n`.length + (size - 1) * 20
  total += xref + `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${'9'.repeat(10)}\n%%EOF\n`.length
  return total
}
