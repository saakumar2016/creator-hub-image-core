// Limits and validation (moved here from the tools' own copies).
import { describe, expect, it } from 'vitest'
import {
  checkFile,
  formatBytes,
  MAX_DIMENSION,
  MAX_FILE_BYTES,
  outputType,
  checkImageSize,
  MAX_MEGAPIXELS,
  MAX_PIXELS,
  withinArea,
} from './limits.ts'

describe('checkFile', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (type) => {
    expect(checkFile({ type, size: 1000 })).toBeNull()
  })
  it.each(['application/pdf', 'image/gif', 'image/svg+xml', 'image/heic', ''])('rejects %s as an unsupported type', (type) => {
    expect(checkFile({ type, size: 1000 })).toBe('type')
  })
  it('rejects an empty file and one over the size limit; accepts exactly the limit', () => {
    expect(checkFile({ type: 'image/png', size: 0 })).toBe('empty')
    expect(checkFile({ type: 'image/png', size: MAX_FILE_BYTES + 1 })).toBe('size')
    expect(checkFile({ type: 'image/png', size: MAX_FILE_BYTES })).toBeNull()
  })
})

describe('output', () => {
  it('outputType keeps the original format unless another is chosen', () => {
    expect(outputType('original', 'image/png')).toBe('image/png')
    expect(outputType('image/webp', 'image/png')).toBe('image/webp')
  })

  it('formatBytes', () => {
    expect(formatBytes(512, 'en')).toBe('512 B')
    expect(formatBytes(840 * 1024, 'en')).toBe('840 KB')
    expect(formatBytes(3.24 * 1024 * 1024, 'en')).toBe('3.2 MB')
    expect(formatBytes(25 * 1024 * 1024, 'en')).toBe('25 MB')
    expect(formatBytes(3.24 * 1024 * 1024, 'de')).toBe('3,2 MB')
  })
})

// Limits (CLAUDE.md §3, option 2), exact boundaries for the source image and the output size.
describe('limits: 25 MB, 10,000 px per side, 50,000,000 pixels', () => {
  it('constants', () => {
    expect(MAX_FILE_BYTES).toBe(25 * 1024 * 1024)
    expect(MAX_DIMENSION).toBe(10_000)
    expect(MAX_PIXELS).toBe(50_000_000)
    expect(MAX_MEGAPIXELS).toBe(50)
  })

  it('file: exactly 25 MB allowed, one byte more rejected', () => {
    expect(checkFile({ type: 'image/jpeg', size: 25 * 1024 * 1024 })).toBeNull()
    expect(checkFile({ type: 'image/jpeg', size: 25 * 1024 * 1024 + 1 })).toBe('size')
  })

  it('area: exactly 50,000,000 pixels allowed, 50,000,001 rejected', () => {
    expect(withinArea(50_000_000, 1)).toBe(true)
    expect(withinArea(50_000_001, 1)).toBe(false)
    expect(withinArea(10_000, 5_000)).toBe(true)
    expect(withinArea(7_072, 7_071)).toBe(false) // 50,006,112
  })

  it('source image: side 10,000 allowed, 10,001 rejected; area over 50 MP rejected', () => {
    expect(checkImageSize(10_000, 5_000)).toBeNull()
    expect(checkImageSize(8_000, 6_250)).toBeNull() // exactly 50,000,000
    expect(checkImageSize(10_001, 10)).toBe('dimensions')
    expect(checkImageSize(10, 10_001)).toBe('dimensions')
    expect(checkImageSize(7_072, 7_071)).toBe('area')
    expect(checkImageSize(10_000, 5_001)).toBe('area')
  })
})
