import { describe, expect, it } from 'vitest'
import { MAX_PAGE_PT, PDF_MIME, PdfError, estimatePdfOverhead, mmToPt, parseJpegSize, pdfStore, pxToPt, writePdf, type PdfPage } from './pdf.ts'

// ---- fixtures: JPEG files with a real segment structure (what the parser and the writer look at) ----
type Fixture = { sof?: number; width?: number; height?: number; components?: number; precision?: number; extra?: number[]; /** the length field of the SOF segment, when it should not match its content */ sofLength?: number; /** components listed in the SOF (default: `components`) */ listed?: number }
function jpeg({ sof = 0xc0, width = 8, height = 8, components = 3, precision = 8, extra = [], sofLength, listed = components }: Fixture = {}): Uint8Array {
  const frame = [precision, height >> 8, height & 255, width >> 8, width & 255, components]
  for (let c = 0; c < listed; c++) frame.push(c + 1, 0x11, 0)
  const sofSegment = [0xff, sof, 0, sofLength ?? frame.length + 2, ...frame]
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x01, 0x2c, 0x01, 0x2c, 0x00, 0x00]
  const scan = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9] // contains a stuffed FF 00
  return Uint8Array.from([0xff, 0xd8, ...app0, ...extra, ...sofSegment, ...scan])
}
const page = (over: Partial<PdfPage> = {}, fixture: Fixture = {}): PdfPage => {
  const { width = 8, height = 8 } = fixture
  return { jpeg: jpeg({ width, height, ...fixture }), widthPx: width, heightPx: height, pageWidthPt: 288, pageHeightPt: 432, ...over }
}
const join = (parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)))
const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('')

/** A reader for what the writer produces: the xref table, every object, every stream. */
function read(bytes: Uint8Array) {
  const text = latin1(bytes)
  expect(text.startsWith('%PDF-1.4\n%')).toBe(true)
  expect(text.endsWith('\n%%EOF\n')).toBe(true)
  const startxref = /startxref\n(\d+)\n%%EOF\n$/.exec(text)!
  const xrefAt = Number(startxref[1])
  expect(text.slice(xrefAt, xrefAt + 5)).toBe('xref\n')
  const header = /^xref\n0 (\d+)\n/.exec(text.slice(xrefAt))!
  const size = Number(header[1])
  const tableStart = xrefAt + header[0].length
  const entries: { offset: number; generation: number; kind: string; raw: string }[] = []
  for (let i = 0; i < size; i++) {
    const raw = text.slice(tableStart + i * 20, tableStart + i * 20 + 20)
    const m = /^(\d{10}) (\d{5}) ([nf]) \n$/.exec(raw)
    expect(m, `xref entry ${i}: ${JSON.stringify(raw)}`).not.toBeNull()
    entries.push({ offset: Number(m![1]), generation: Number(m![2]), kind: m![3], raw })
  }
  const trailerAt = tableStart + size * 20
  const trailer = /^trailer\n<< \/Size (\d+) \/Root (\d+) 0 R >>\nstartxref\n/.exec(text.slice(trailerAt))!
  expect(Number(trailer[1])).toBe(size)
  expect(Number(trailer[2])).toBe(1)
  return { text, size, xrefAt, entries, tableStart, trailerAt }
}

describe('estimates and units', () => {
  it('mmToPt: 35 × 45 mm = 99.213 × 127.559 pt, A4 = 595.276 × 841.89 pt, 152.4 mm = 432 pt exactly', () => {
    expect([mmToPt(35), mmToPt(45)]).toEqual([99.213, 127.559])
    expect([mmToPt(210), mmToPt(297)]).toEqual([595.276, 841.89])
    expect([mmToPt(101.6), mmToPt(152.4), mmToPt(25.4)]).toEqual([288, 432, 72])
  })
  it('pxToPt: 96 px = 72 pt by default, 1200 px at 300 dpi = 288 pt', () => {
    expect([pxToPt(96), pxToPt(1), pxToPt(1200, 300), pxToPt(300, 300)]).toEqual([72, 0.75, 288, 72])
  })
})

describe('parseJpegSize', () => {
  it('reads width, height and components of a baseline (SOF0) JPEG, colour and gray', () => {
    expect(parseJpegSize(jpeg({ width: 413, height: 531 }))).toEqual({ width: 413, height: 531, components: 3 })
    expect(parseJpegSize(jpeg({ width: 2480, height: 3508 }))).toEqual({ width: 2480, height: 3508, components: 3 })
    expect(parseJpegSize(jpeg({ components: 1, width: 70, height: 20 }))).toEqual({ width: 70, height: 20, components: 1 })
    expect(parseJpegSize(jpeg({ width: 65535, height: 65535 }))).toEqual({ width: 65535, height: 65535, components: 3 })
  })
  it('refuses an extended sequential (SOF1) JPEG with a clear error', () => {
    expect(() => parseJpegSize(jpeg({ sof: 0xc1 }))).toThrow(PdfError)
    expect(() => parseJpegSize(jpeg({ sof: 0xc1 }))).toThrow(/extended sequential.*only baseline JPEGs are supported/)
    expect(() => pdfStore([page({}, { sof: 0xc1 })])).toThrow(/extended sequential/)
  })
  describe('a damaged or cut-off frame header never gives a size', () => {
    it('the segment is shorter than a frame header needs (length 2…7)', () => {
      for (const sofLength of [2, 3, 4, 5, 6, 7]) expect(() => parseJpegSize(jpeg({ sofLength })), `length ${sofLength}`).toThrow(PdfError)
      expect(() => parseJpegSize(jpeg({ sofLength: 7 }))).toThrow(/too short/)
    })
    it('the length does not equal 8 + 3 × components (too short or too long)', () => {
      expect(() => parseJpegSize(jpeg({ sofLength: 10 }))).toThrow(/wrong length/) // 3 components need 17
      expect(() => parseJpegSize(jpeg({ sofLength: 18 }))).toThrow(/wrong length/)
      expect(() => parseJpegSize(jpeg({ components: 1, sofLength: 17 }))).toThrow(/wrong length/) // gray needs 11
      expect(() => parseJpegSize(jpeg({ components: 3, listed: 1 }))).toThrow(/wrong length|Damaged/) // says 3 components, lists 1
      expect(() => parseJpegSize(jpeg({ components: 1, listed: 3 }))).toThrow(/wrong length|Damaged/)
    })
    it('the length field is larger than the bytes that are left', () => {
      expect(() => parseJpegSize(jpeg({ sofLength: 0x2000 }))).toThrow(/cut off/)
      const whole = jpeg()
      const at = whole.findIndex((_, i) => whole[i] === 0xff && whole[i + 1] === 0xc0)
      expect(() => parseJpegSize(whole.subarray(0, at + 2 + 17 - 1))).toThrow(/cut off/) // one byte of the segment missing
      expect(() => parseJpegSize(whole.subarray(0, at + 6))).toThrow(PdfError)
    })
    it('zero width or zero height', () => {
      expect(() => parseJpegSize(jpeg({ width: 0 }))).toThrow(/size is 0/)
      expect(() => parseJpegSize(jpeg({ height: 0 }))).toThrow(/size is 0/)
    })
    it('a wrong component count: 0, 2, 4', () => {
      for (const components of [0, 2, 4]) expect(() => parseJpegSize(jpeg({ components })), `${components} components`).toThrow(PdfError)
      expect(() => parseJpegSize(jpeg({ components: 2 }))).toThrow(/2 components/)
      expect(() => parseJpegSize(jpeg({ components: 4 }))).toThrow(/CMYK/)
    })
  })
  it('skips other segments before the frame header (Exif, ICC, comments)', () => {
    const exif = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00]
    expect(parseJpegSize(jpeg({ extra: [...exif, 0xff, 0xfe, 0x00, 0x04, 0x68, 0x69], width: 100, height: 50 }))).toEqual({ width: 100, height: 50, components: 3 })
  })
  it('errors that say what is wrong: not a JPEG, progressive, arithmetic, CMYK, 12-bit, cut off', () => {
    expect(() => parseJpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]))).toThrow(/Not a JPEG/)
    expect(() => parseJpegSize(new Uint8Array(0))).toThrow(PdfError)
    expect(() => parseJpegSize(jpeg({ sof: 0xc2 }))).toThrow(/progressive.*only baseline JPEGs are supported/)
    expect(() => parseJpegSize(jpeg({ sof: 0xc9 }))).toThrow(/arithmetic-coded/)
    expect(() => parseJpegSize(jpeg({ sof: 0xc3 }))).toThrow(/lossless/)
    expect(() => parseJpegSize(jpeg({ components: 4 }))).toThrow(/4 components.*not CMYK/)
    expect(() => parseJpegSize(jpeg({ components: 2 }))).toThrow(/2 components/)
    expect(() => parseJpegSize(jpeg({ precision: 12 }))).toThrow(/12-bit/)
    expect(() => parseJpegSize(jpeg().subarray(0, 30))).toThrow(/Damaged/)
    expect(() => parseJpegSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toThrow(/no frame header/)
  })
})

describe('pdfStore: one page', () => {
  const input = page({ pageWidthPt: 288, pageHeightPt: 432 }, { width: 1200, height: 1800 })
  const bytes = join(pdfStore([input]))
  const doc = read(bytes)

  it('every xref offset is the position of "N 0 obj"; entry 0 is the free head; entries are 20 bytes', () => {
    expect(doc.size).toBe(6) // 0 free, 1 catalog, 2 pages, 3 page, 4 image, 5 contents
    expect(doc.entries[0]).toMatchObject({ offset: 0, generation: 65535, kind: 'f' })
    expect(doc.entries[0].raw).toBe('0000000000 65535 f \n')
    for (let id = 1; id < doc.size; id++) {
      expect(doc.entries[id].kind).toBe('n')
      expect(doc.text.startsWith(`${id} 0 obj\n`, doc.entries[id].offset), `object ${id}`).toBe(true)
    }
    // the objects are in order and each ends with endobj right before the next one
    for (let id = 1; id < doc.size - 1; id++) expect(doc.text.slice(doc.entries[id + 1].offset - 7, doc.entries[id + 1].offset)).toBe('endobj\n')
    expect(doc.text.slice(doc.xrefAt - 7, doc.xrefAt)).toBe('endobj\n')
  })

  it('startxref points at the "xref" keyword; the trailer has /Size and /Root; the file ends with %%EOF', () => {
    expect(doc.text.slice(doc.xrefAt, doc.xrefAt + 4)).toBe('xref')
    expect(doc.text).toContain('trailer\n<< /Size 6 /Root 1 0 R >>')
    expect(doc.text.endsWith('startxref\n' + doc.xrefAt + '\n%%EOF\n')).toBe(true)
  })

  it('catalog, page tree (1 page), page with MediaBox, resources and contents', () => {
    expect(doc.text).toContain('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
    expect(doc.text).toContain('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
    expect(doc.text).toContain('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 432] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n')
  })

  it('the image: DCTDecode, DeviceRGB, 8 bits, its pixel size, /Length = the JPEG length; the bytes are the input bytes', () => {
    expect(doc.text).toContain('/Type /XObject /Subtype /Image /Width 1200 /Height 1800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + input.jpeg.length + ' >>\nstream\n')
    const at = doc.entries[4].offset + doc.text.slice(doc.entries[4].offset).indexOf('stream\n') + 7
    expect(Array.from(bytes.subarray(at, at + input.jpeg.length))).toEqual(Array.from(input.jpeg))
    expect(doc.text.slice(at + input.jpeg.length, at + input.jpeg.length + 17)).toBe('\nendstream\nendobj')
  })

  it('the content stream draws the image on the whole page: q W 0 0 H 0 0 cm /Im0 Do Q, with its exact /Length', () => {
    const content = 'q 288 0 0 432 0 0 cm /Im0 Do Q'
    expect(doc.text).toContain(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`)
  })

  it('no metadata: no /Info, no /Producer, no /Creator, no dates, no XMP', () => {
    expect(doc.text).not.toMatch(/\/Info|\/Producer|\/Creator|\/CreationDate|\/ModDate|\/Metadata|\/Author|\/Title/)
  })

  it('a gray JPEG uses DeviceGray', () => {
    const gray = latin1(join(pdfStore([page({}, { components: 1 })])))
    expect(gray).toContain('/ColorSpace /DeviceGray')
  })

  it('page sizes keep their decimals: 35 × 45 mm = 99.213 × 127.559 pt, A4 = 595.276 × 841.89', () => {
    const small = latin1(join(pdfStore([page({ pageWidthPt: mmToPt(35), pageHeightPt: mmToPt(45) })])))
    expect(small).toContain('/MediaBox [0 0 99.213 127.559]')
    expect(small).toContain('q 99.213 0 0 127.559 0 0 cm /Im0 Do Q')
    const a4 = latin1(join(pdfStore([page({ pageWidthPt: mmToPt(210), pageHeightPt: mmToPt(297) })])))
    expect(a4).toContain('/MediaBox [0 0 595.276 841.89]')
  })

  it('numbers never use an exponent, and extra decimals are rounded to 3', () => {
    const text = latin1(join(pdfStore([page({ pageWidthPt: 0.001, pageHeightPt: 100.00049 })])))
    expect(text).toContain('/MediaBox [0 0 0.001 100]')
    expect(text).not.toMatch(/e[+-]\d/)
  })
})

describe('pdfStore: several pages', () => {
  const pages = [page({ pageWidthPt: 100, pageHeightPt: 200 }, { width: 50, height: 60 }), page({ pageWidthPt: 300, pageHeightPt: 150 }, { width: 70, height: 40, components: 1 }), page({ pageWidthPt: 99.213, pageHeightPt: 127.559 }, { width: 413, height: 531 })]
  const bytes = join(pdfStore(pages))
  const doc = read(bytes)

  it('page count, page tree order, object numbers and xref for 3 pages', () => {
    expect(doc.size).toBe(12)
    expect(doc.text).toContain('2 0 obj\n<< /Type /Pages /Kids [3 0 R 6 0 R 9 0 R] /Count 3 >>')
    expect((doc.text.match(/\/Type \/Page \//g) ?? []).length).toBe(3)
    for (let id = 1; id < doc.size; id++) expect(doc.text.startsWith(`${id} 0 obj\n`, doc.entries[id].offset), `object ${id}`).toBe(true)
  })

  it('each page has its own MediaBox, its own image bytes and its own content stream', () => {
    ;[3, 6, 9].forEach((id, i) => {
      const box = `/MediaBox [0 0 ${pages[i].pageWidthPt} ${pages[i].pageHeightPt}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R`
      expect(doc.text).toContain(`${id} 0 obj\n<< /Type /Page /Parent 2 0 R ${box} >>`)
      const at = doc.entries[id + 1].offset + doc.text.slice(doc.entries[id + 1].offset).indexOf('stream\n') + 7
      expect(Array.from(bytes.subarray(at, at + pages[i].jpeg.length))).toEqual(Array.from(pages[i].jpeg))
    })
    expect(doc.text).toContain('/Width 70 /Height 40 /ColorSpace /DeviceGray')
  })

  it('a JPEG that contains the text "endstream" or "obj" does not confuse the offsets', () => {
    const comment = Array.from('\nendstream\nendobj 9 0 obj', (c) => c.charCodeAt(0))
    const tricky = page({}, { extra: [0xff, 0xfe, 0x00, comment.length + 2, ...comment] })
    const out = join(pdfStore([tricky, page()]))
    const d = read(out)
    for (let id = 1; id < d.size; id++) expect(d.text.startsWith(`${id} 0 obj\n`, d.entries[id].offset)).toBe(true)
  })
})

describe('input errors', () => {
  it('no pages', () => expect(() => pdfStore([])).toThrow(/at least one page/))
  it('a size that does not match the JPEG', () => {
    expect(() => pdfStore([page({ widthPx: 9 })])).toThrow(/Page 1: the JPEG is 8 × 8 px, not 9 × 8/)
    expect(() => pdfStore([page(), page({ heightPx: 7 })])).toThrow(/Page 2/)
  })
  it('not a JPEG, progressive, CMYK', () => {
    expect(() => pdfStore([{ ...page(), jpeg: new Uint8Array([1, 2, 3, 4, 5]) }])).toThrow(/Not a JPEG/)
    expect(() => pdfStore([page({}, { sof: 0xc2 })])).toThrow(/progressive/)
    expect(() => pdfStore([page({}, { components: 4 })])).toThrow(/CMYK/)
  })
  it('a page size that is 0, negative, not a number, infinite or over 14,400 pt', () => {
    for (const bad of [0, -5, NaN, Infinity, MAX_PAGE_PT + 1]) {
      expect(() => pdfStore([page({ pageWidthPt: bad })]), `width ${bad}`).toThrow(/pageWidthPt must be above 0/)
      expect(() => pdfStore([page({ pageHeightPt: bad })]), `height ${bad}`).toThrow(/pageHeightPt/)
    }
    expect(() => pdfStore([page({ pageWidthPt: MAX_PAGE_PT, pageHeightPt: MAX_PAGE_PT })])).not.toThrow()
  })
})

describe('writePdf and the overhead', () => {
  it('returns a Blob of type application/pdf with the size of the parts', () => {
    const input = page({}, { width: 413, height: 531 })
    const blob = writePdf([input])
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe(PDF_MIME)
    expect(PDF_MIME).toBe('application/pdf')
    expect(blob.size).toBe(join(pdfStore([input])).length)
  })

  it('the overhead of a 1-page PDF over the JPEG data is a few hundred bytes; the estimate is never below the real one', () => {
    const cases: PdfPage[][] = [
      [page({ pageWidthPt: 288, pageHeightPt: 432 }, { width: 1200, height: 1800 })],
      [page({ pageWidthPt: mmToPt(35), pageHeightPt: mmToPt(45) }, { width: 413, height: 531 })],
      [page({ pageWidthPt: mmToPt(210), pageHeightPt: mmToPt(297) }, { width: 2480, height: 3508 })],
      [page({ pageWidthPt: MAX_PAGE_PT, pageHeightPt: MAX_PAGE_PT }, { width: 65535, height: 65535 })],
      [page({ pageWidthPt: 1, pageHeightPt: 1 }, { width: 1, height: 1, components: 1 })],
      Array.from({ length: 12 }, () => page({ pageWidthPt: mmToPt(35), pageHeightPt: mmToPt(45) }, { width: 413, height: 531 })),
    ]
    for (const pages of cases) {
      const real = join(pdfStore(pages)).length - pages.reduce((n, p) => n + p.jpeg.length, 0)
      const estimate = estimatePdfOverhead(pages.length)
      expect(estimate).toBeGreaterThanOrEqual(real)
      expect(estimate - real).toBeLessThan(60 * pages.length + 20) // close to the real number
    }
    const one = join(pdfStore([page({ pageWidthPt: 288, pageHeightPt: 432 }, { width: 1200, height: 1800 })])).length - jpeg({ width: 1200, height: 1800 }).length
    expect(one).toBeGreaterThan(500)
    expect(one).toBeLessThan(800)
  })

  it('estimatePdfOverhead grows with the page count and refuses a count that is not a whole number ≥ 1', () => {
    expect(estimatePdfOverhead(2)).toBeGreaterThan(estimatePdfOverhead(1))
    expect(estimatePdfOverhead(100)).toBeGreaterThan(estimatePdfOverhead(99))
    for (const bad of [0, -1, 1.5, NaN]) expect(() => estimatePdfOverhead(bad)).toThrow(PdfError)
  })
})
