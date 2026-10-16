import { describe, expect, it, vi } from 'vitest'
import { canEncode, createCanvas, decodeImage, encodeCanvas, EncodeError, fillWhite, ImageDecodeError, UnsupportedOutputError } from './codec.ts'

/** A canvas double that encodes to `encoded` (a type, or null = failure). */
function fakeCanvas(encoded: string | null) {
  return {
    width: 10,
    height: 20,
    getContext: vi.fn(),
    toBlob: vi.fn((callback: BlobCallback, type?: string) => callback(encoded === null ? null : new Blob(['x'], { type: encoded ?? type }))),
  }
}

describe('decodeImage', () => {
  it('returns the bitmap and its oriented size', async () => {
    const bitmap = { width: 300, height: 200, close: vi.fn() }
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    await expect(decodeImage(new Blob(['x']))).resolves.toEqual({ bitmap, width: 300, height: 200 })
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: 'from-image' })
    vi.unstubAllGlobals()
  })

  it('a file the browser cannot decode is an ImageDecodeError', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Promise.reject(new DOMException('bad', 'InvalidStateError'))))
    await expect(decodeImage(new Blob(['x']))).rejects.toBeInstanceOf(ImageDecodeError)
    vi.unstubAllGlobals()
  })
})

describe('encodeCanvas', () => {
  it('encodes the chosen type: PNG without quality, JPG and WebP with 0.92 by default or the given quality', async () => {
    const png = fakeCanvas('image/png')
    expect((await encodeCanvas(png, 'image/png')).type).toBe('image/png')
    expect(png.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined)
    const jpg = fakeCanvas('image/jpeg')
    await encodeCanvas(jpg, 'image/jpeg')
    expect(jpg.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92)
    const webp = fakeCanvas('image/webp')
    await encodeCanvas(webp, 'image/webp', 0.75)
    expect(webp.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.75)
  })
  it('a browser that falls back to PNG for WebP is reported, not saved under the wrong name', async () => {
    await expect(encodeCanvas(fakeCanvas('image/png'), 'image/webp')).rejects.toBeInstanceOf(UnsupportedOutputError)
  })
  it('encoding failure (e.g. a canvas too large for the device) is an EncodeError', async () => {
    await expect(encodeCanvas(fakeCanvas(null), 'image/png')).rejects.toThrow(EncodeError)
    await expect(encodeCanvas(fakeCanvas(null), 'image/png')).rejects.toThrow('Could not encode a 10 × 20 image')
  })
})

describe('canEncode', () => {
  it('true when a 1 × 1 canvas encodes as the type; false when the browser falls back; the canvas is emptied', async () => {
    const yes = fakeCanvas('image/webp')
    expect(await canEncode('image/webp', () => yes)).toBe(true)
    expect([yes.width, yes.height]).toEqual([0, 0])
    expect(await canEncode('image/webp', () => fakeCanvas('image/png'))).toBe(false)
    expect(await canEncode('image/webp', () => fakeCanvas(null))).toBe(false)
  })
})

it('fillWhite paints the whole area white (JPG has no transparency)', () => {
  const context = { fillStyle: '', fillRect: vi.fn() }
  fillWhite(context, 640, 480)
  expect(context.fillStyle).toBe('#ffffff')
  expect(context.fillRect).toHaveBeenCalledWith(0, 0, 640, 480)
})

it('createCanvas makes a DOM canvas', () => {
  expect(createCanvas()).toBeInstanceOf(HTMLCanvasElement)
})
