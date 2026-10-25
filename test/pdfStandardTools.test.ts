import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { mmToPt, parseJpegSize, pdfStore } from '../src/pdf.ts'

// The PDF writer (src/pdf.ts), opened with standard tools: poppler's pdfinfo and pdfimages,
// Ghostscript, qpdf and mutool. Each tool's tests run only when that tool is installed (and the
// number that ran is in the test report: a skipped test is not a pass). No other helper is needed:
// the JPEG files below are small baseline (SOF0) images stored in this file.
const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'))

// 16 × 16 px, 3 components (4:4:4), one flat colour in each 8 × 8 quadrant:
// top left red (220, 30, 30), top right green (30, 170, 50), bottom left blue (30, 60, 220), bottom right yellow (240, 220, 40).
const RGB_16 = fromBase64(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoK' +
  'CgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoK' +
  'CgoKCgoKCgr/wAARCAAQABADAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUF' +
  'BAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVW' +
  'V1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi' +
  '4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAEC' +
  'AxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVm' +
  'Z2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq' +
  '8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5br+fz/Xw9srzz/mTPkuv95D+gD+iCv8Ak3P7UP/Z',
)
// 16 × 16 px, 1 component, one grey value in each quadrant: 20, 100, 180, 240 (top left, top right, bottom left, bottom right).
const GRAY_16 = fromBase64(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoK' +
  'CgoKBggLDAsKDAkKCgr/wAALCAAQABABAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUF' +
  'BAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVW' +
  'V1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi' +
  '4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APxPr9QK/UCvvCv/2Q==',
)

/** Is `command` installed? (Only a missing program counts: a tool that fails on a file is a failure, not a skip.) */
const installed = (command: string, args: string[]) => {
  const run = spawnSync(command, args, { encoding: 'utf8' })
  return (run.error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT'
}
const HAS = { pdfinfo: installed('pdfinfo', ['-v']), pdfimages: installed('pdfimages', ['-v']), gs: installed('gs', ['--version']), qpdf: installed('qpdf', ['--version']), mutool: installed('mutool', ['-v']) }

/** A binary PPM (P6): "P6", optional # comment lines, width, height, 255, one whitespace byte, then the pixels. */
function readPpm(file: Buffer) {
  const text = file.subarray(0, 200).toString('latin1')
  const tokens: string[] = []
  let at = 0
  while (tokens.length < 4) {
    while (/\s/.test(text[at])) at++
    if (text[at] === '#') {
      at = text.indexOf('\n', at) + 1
      continue
    }
    const end = at + text.slice(at).search(/\s/)
    tokens.push(text.slice(at, end))
    at = end
  }
  expect(tokens[0]).toBe('P6')
  expect(tokens[3]).toBe('255')
  return { width: Number(tokens[1]), height: Number(tokens[2]), start: at + 1 }
}

const dir = mkdtempSync(join(tmpdir(), 'pdf-test-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// Three pages: 35 × 45 mm (the colour image), a 300 × 200 pt gray page, and A4.
const pages = [
  { jpeg: RGB_16, widthPx: 16, heightPx: 16, pageWidthPt: mmToPt(35), pageHeightPt: mmToPt(45) },
  { jpeg: GRAY_16, widthPx: 16, heightPx: 16, pageWidthPt: 300, pageHeightPt: 200 },
  { jpeg: RGB_16, widthPx: 16, heightPx: 16, pageWidthPt: mmToPt(210), pageHeightPt: mmToPt(297) },
]
const file = join(dir, 'out.pdf')
writeFileSync(file, Buffer.concat(pdfStore(pages)))

describe('the test JPEG files', () => {
  it('are baseline files that the parser reads', () => {
    expect(parseJpegSize(RGB_16)).toEqual({ width: 16, height: 16, components: 3 })
    expect(parseJpegSize(GRAY_16)).toEqual({ width: 16, height: 16, components: 1 })
  })
})

describe('writePdf output with standard tools', () => {
  it.skipIf(!HAS.pdfinfo)('pdfinfo (poppler): 3 pages with the exact sizes, no errors', () => {
    const run = (extra: string[]) => spawnSync('pdfinfo', [...extra, file], { encoding: 'utf8' })
    const first = run([])
    expect(first.stderr).toBe('')
    expect(first.status).toBe(0)
    expect(first.stdout).toMatch(/Pages:\s+3/)
    expect(first.stdout).toMatch(/Encrypted:\s+no/)
    const sizes = run(['-f', '1', '-l', '3']).stdout
    expect(sizes).toMatch(/Page\s+1 size:\s+99\.213 x 127\.559 pts/)
    expect(sizes).toMatch(/Page\s+2 size:\s+300 x 200 pts/)
    expect(sizes).toMatch(/Page\s+3 size:\s+595\.276 x 841\.89 pts/)
    expect(first.stdout).not.toMatch(/Creator|Producer|CreationDate/)
  })

  it.skipIf(!HAS.pdfimages)('pdfimages: the JPEGs are embedded as jpeg (DCT) with their sizes and colour', () => {
    const run = spawnSync('pdfimages', ['-list', file], { encoding: 'utf8' })
    expect(run.status).toBe(0)
    expect(run.stdout).toMatch(/1\s+0 image\s+16\s+16\s+rgb\s+3\s+8\s+jpeg/)
    expect(run.stdout).toMatch(/2\s+1 image\s+16\s+16\s+gray\s+1\s+8\s+jpeg/)
    expect(run.stdout).toMatch(/3\s+2 image\s+16\s+16\s+rgb\s+3\s+8\s+jpeg/)
  })

  it.skipIf(!HAS.gs)('Ghostscript opens it without a warning, renders every page, and the quadrants have their colours', () => {
    const run = spawnSync('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=ppmraw', '-r72', `-sOutputFile=${join(dir, 'page-%d.ppm')}`, file], { encoding: 'utf8' })
    expect(`${run.stdout}${run.stderr}`.trim()).toBe('')
    expect(run.status).toBe(0)
    // Page 1 is 99.213 × 127.559 pt, rendered at 72 dpi: the image fills the page, so each quadrant is a quarter of it.
    const ppm = readFileSync(join(dir, 'page-1.ppm'))
    const { width, height, start } = readPpm(ppm)
    expect([width, height]).toEqual([99, 128])
    const pixel = (x: number, y: number) => Array.from(ppm.subarray(start + (y * width + x) * 3, start + (y * width + x) * 3 + 3))
    const near = (got: number[], want: number[]) => got.every((v, i) => Math.abs(v - want[i]) <= 16)
    expect(near(pixel(25, 32), [220, 30, 30])).toBe(true) // top left
    expect(near(pixel(75, 32), [30, 170, 50])).toBe(true) // top right
    expect(near(pixel(25, 96), [30, 60, 220])).toBe(true) // bottom left
    expect(near(pixel(75, 96), [240, 220, 40])).toBe(true) // bottom right
    for (const n of [2, 3]) expect(readFileSync(join(dir, `page-${n}.ppm`)).subarray(0, 2).toString()).toBe('P6')
  })

  it.skipIf(!HAS.qpdf)('qpdf --check finds no problem', () => {
    const run = spawnSync('qpdf', ['--check', file], { encoding: 'utf8' })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('No syntax or stream encoding errors found')
  })

  it.skipIf(!HAS.mutool)('mutool info opens it', () => {
    expect(spawnSync('mutool', ['info', file], { encoding: 'utf8' }).status).toBe(0)
  })
})
