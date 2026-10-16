import { describe, expect, it } from 'vitest'
import { crc32, MAX_ZIP_BYTES, zipSize, zipStore, ZipTooLargeError } from './zip.ts'

const bytes = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
const text = (s: string) => new TextEncoder().encode(s)
const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8)
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(text(''))).toBe(0)
    expect(crc32(text('123456789'))).toBe(0xcbf43926) // the CRC-32 check value
    expect(crc32(text('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })
})

describe('zipStore', () => {
  const entries = [
    { name: 'kurti-1.jpg', data: new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]) },
    { name: 'कुर्ता-2.jpg', data: text('second file') },
    { name: '夏季-3.webp', data: new Uint8Array(0) },
  ]
  const zip = bytes(zipStore(entries, new Date(2026, 9, 16, 12, 34, 56)))

  it('structure: local headers, central directory, end record; stored, UTF-8 names, CRC and sizes', () => {
    expect(u32(zip, 0)).toBe(0x04034b50)
    expect(u16(zip, 6)).toBe(0x0800) // UTF-8 flag
    expect(u16(zip, 8)).toBe(0) // stored
    expect(u32(zip, 14)).toBe(crc32(entries[0].data))
    expect(u32(zip, 18)).toBe(7)
    const end = zip.length - 22
    expect(u32(zip, end)).toBe(0x06054b50)
    expect(u16(zip, end + 10)).toBe(3)
    const cdOffset = u32(zip, end + 16)
    expect(u32(zip, cdOffset)).toBe(0x02014b50)
    expect(u32(zip, end + 12)).toBe(end - cdOffset)
    expect(zip.length).toBe(zipSize(entries.map((e) => ({ name: e.name, size: e.data.length }))))
  })

  it('refuses a ZIP above the size guard (well below 4 GB, no Zip64)', () => {
    expect(MAX_ZIP_BYTES).toBeLessThan(4 * 1024 ** 3)
    const big = { name: 'big.jpg', data: { length: MAX_ZIP_BYTES } as unknown as Uint8Array<ArrayBuffer> }
    expect(() => zipStore([big])).toThrow(ZipTooLargeError)
  })
})
