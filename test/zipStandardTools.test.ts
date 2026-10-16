import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { zipStore } from '../src/zip.ts'

// The "Download all (ZIP)" writer (src/zip.ts), opened with standard tools:
// Python's zipfile (testzip checks every CRC) and `unzip -t`. Here (Node types) because it runs
// processes; the format tests are in src/zip.test.ts.
const text = (s: string) => new TextEncoder().encode(s)
const entries = [
  { name: 'kurti-1.jpg', data: new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]) },
  { name: 'कुर्ता-2.jpg', data: text('second file') },
  { name: '夏季-3.webp', data: new Uint8Array(0) },
]

describe('zipStore output', () => {
  it('opens with standard tools: Python zipfile and unzip -t (names, contents, CRC)', () => {
    const parts = zipStore(entries, new Date(2026, 9, 16, 12, 34, 56))
    const zip = Buffer.concat(parts)
    const dir = mkdtempSync(join(tmpdir(), 'zip-test-'))
    try {
      const file = join(dir, 'photos.zip')
      writeFileSync(file, zip)
      const py = execFileSync('python3', ['-c', 'import sys, zipfile, json; z = zipfile.ZipFile(sys.argv[1]); print(json.dumps({"bad": z.testzip(), "names": z.namelist(), "sizes": [i.file_size for i in z.infolist()], "second": z.read(z.namelist()[1]).decode()}, ensure_ascii=False))', file], { encoding: 'utf8' })
      expect(JSON.parse(py)).toEqual({ bad: null, names: ['kurti-1.jpg', 'कुर्ता-2.jpg', '夏季-3.webp'], sizes: [7, 11, 0], second: 'second file' })
      const unzip = execFileSync('unzip', ['-t', file], { encoding: 'utf8' })
      expect(unzip).toContain('No errors detected')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

})
