import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mmToPt, parseJpegSize, pdfStore } from '../src/pdf.ts'

// The PDF writer (src/pdf.ts), opened with standard tools when they are installed: poppler's
// pdfinfo and pdfimages, Ghostscript, qpdf and mutool. A tool that is not installed is skipped;
// the format tests are in src/pdf.test.ts. The JPEGs are made with Python's Pillow.
const has = (command: string, args: string[] = ['--version']) => spawnSync(command, args, { encoding: 'utf8' }).error === undefined
const pillow = spawnSync('python3', ['-c', 'import PIL'], { encoding: 'utf8' }).status === 0

function makeJpeg(dir: string, name: string, mode: 'RGB' | 'L', width: number, height: number, extra = ''): Uint8Array {
  const file = join(dir, name)
  const code = `
import sys
from PIL import Image, ImageDraw
mode, w, h, path = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
im = Image.new(mode, (w, h), 255 if mode == 'L' else (255, 255, 255))
d = ImageDraw.Draw(im)
d.rectangle((0, 0, w // 2, h // 2), fill=0 if mode == 'L' else (200, 30, 30))
d.ellipse((w // 4, h // 4, 3 * w // 4, 3 * h // 4), fill=90 if mode == 'L' else (30, 60, 200))
im.save(path, 'JPEG', quality=90${extra})
`
  execFileSync('python3', ['-c', code, mode, String(width), String(height), file])
  return new Uint8Array(readFileSync(file))
}

describe.skipIf(!pillow)('writePdf output with standard tools', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-test-'))
  const rgb = makeJpeg(dir, 'rgb.jpg', 'RGB', 413, 531)
  const gray = makeJpeg(dir, 'gray.jpg', 'L', 300, 200)
  const big = makeJpeg(dir, 'a4.jpg', 'RGB', 2480, 3508)
  const progressive = makeJpeg(dir, 'progressive.jpg', 'RGB', 64, 64, ', progressive=True')
  const cmyk = (() => {
    const file = join(dir, 'cmyk.jpg')
    execFileSync('python3', ['-c', 'from PIL import Image; import sys; Image.new("CMYK", (16, 16), (0, 0, 0, 0)).save(sys.argv[1], "JPEG")', file])
    return new Uint8Array(readFileSync(file))
  })()
  const pages = [
    { jpeg: rgb, widthPx: 413, heightPx: 531, pageWidthPt: mmToPt(35), pageHeightPt: mmToPt(45) },
    { jpeg: gray, widthPx: 300, heightPx: 200, pageWidthPt: 300, pageHeightPt: 200 },
    { jpeg: big, widthPx: 2480, heightPx: 3508, pageWidthPt: mmToPt(210), pageHeightPt: mmToPt(297) },
  ]
  const file = join(dir, 'out.pdf')
  writeFileSync(file, Buffer.concat(pdfStore(pages)))

  it('the parser reads what Pillow wrote, and refuses a progressive and a CMYK JPEG', () => {
    expect(parseJpegSize(rgb)).toEqual({ width: 413, height: 531, components: 3 })
    expect(parseJpegSize(gray)).toEqual({ width: 300, height: 200, components: 1 })
    expect(() => parseJpegSize(progressive)).toThrow(/progressive/)
    expect(() => parseJpegSize(cmyk)).toThrow(/4 components/)
  })

  it.skipIf(!has('pdfinfo', ['-v']))('pdfinfo (poppler): 3 pages with the exact sizes, no errors', () => {
    const run = (extra: string[]) => spawnSync('pdfinfo', [...extra, file], { encoding: 'utf8' })
    const first = run([])
    expect(first.stderr).toBe('')
    expect(first.stdout).toMatch(/Pages:\s+3/)
    expect(first.stdout).toMatch(/Encrypted:\s+no/)
    const sizes = run(['-f', '1', '-l', '3']).stdout
    expect(sizes).toMatch(/Page\s+1 size:\s+99\.213 x 127\.559 pts/)
    expect(sizes).toMatch(/Page\s+2 size:\s+300 x 200 pts/)
    expect(sizes).toMatch(/Page\s+3 size:\s+595\.276 x 841\.89 pts/)
    expect(first.stdout).not.toMatch(/Creator|Producer|CreationDate/)
  })

  it.skipIf(!has('pdfimages', ['-v']))('pdfimages: the JPEGs are embedded as jpeg (DCT) with their sizes and colour', () => {
    const out = spawnSync('pdfimages', ['-list', file], { encoding: 'utf8' }).stdout
    expect(out).toMatch(/1\s+0 image\s+413\s+531\s+rgb\s+3\s+8\s+jpeg/)
    expect(out).toMatch(/2\s+1 image\s+300\s+200\s+gray\s+1\s+8\s+jpeg/)
    expect(out).toMatch(/3\s+2 image\s+2480\s+3508\s+rgb\s+3\s+8\s+jpeg/)
  })

  it.skipIf(!has('gs'))('Ghostscript opens it without a warning and renders all pages', () => {
    const run = spawnSync('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=png16m', '-r36', `-sOutputFile=${join(dir, 'page-%d.png')}`, file], { encoding: 'utf8' })
    expect(`${run.stdout}${run.stderr}`.trim()).toBe('')
    expect(run.status).toBe(0)
    for (const n of [1, 2, 3]) expect(readFileSync(join(dir, `page-${n}.png`)).subarray(1, 4).toString()).toBe('PNG')
  })

  it.skipIf(!has('qpdf'))('qpdf --check finds no problem', () => {
    const run = spawnSync('qpdf', ['--check', file], { encoding: 'utf8' })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('No syntax or stream encoding errors found')
  })

  it.skipIf(!has('mutool', ['-v']))('mutool info opens it', () => {
    expect(spawnSync('mutool', ['info', file], { encoding: 'utf8' }).status).toBe(0)
  })

  it('cleans up', () => rmSync(dir, { recursive: true, force: true }))
})
