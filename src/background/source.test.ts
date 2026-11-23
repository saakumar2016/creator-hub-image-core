import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toCanvas, toRgba } from './source.ts'
import { discPhoto } from './fixtures.ts'
import { composeRgba } from './core.ts'

afterEach(() => vi.unstubAllGlobals())

describe('toRgba', () => {
  it('takes pixels as they are (an ImageData has this shape)', () => {
    const photo = discPhoto(20, 10)
    expect(toRgba(photo)).toBe(photo)
  })
  it('refuses an empty picture, a bad size, too few bytes and more than 50 MP', () => {
    expect(() => toRgba({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toThrow(RangeError)
    expect(() => toRgba({ data: new Uint8ClampedArray(16), width: 1.5, height: 2 })).toThrow(RangeError)
    expect(() => toRgba({ data: new Uint8ClampedArray(10), width: 2, height: 2 })).toThrow(/width × height × 4/)
    expect(() => toRgba({ data: new Uint8ClampedArray(4), width: 10_000, height: 5_001 })).toThrow(/limit/)
  })
  it('reads a canvas or a bitmap through a 2D context at the photo\'s own size', () => {
    const photo = discPhoto(8, 6)
    const drawImage = vi.fn()
    const ctx = { drawImage, getImageData: () => ({ data: photo.data, width: 8, height: 6 }) }
    vi.stubGlobal('OffscreenCanvas', class { width: number; height: number; constructor(w: number, h: number) { this.width = w; this.height = h } getContext() { return ctx } })
    const bitmap = { width: 8, height: 6 } as unknown as ImageBitmap
    const out = toRgba(bitmap)
    expect([out.width, out.height]).toEqual([8, 6])
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0)
  })
})

describe('toCanvas (composeBackground\'s last step)', () => {
  it('puts the pixels on a canvas of the same size', () => {
    const put = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ putImageData: put })) as never)
    vi.stubGlobal('ImageData', class { data: Uint8ClampedArray; width: number; height: number; constructor(d: Uint8ClampedArray, w: number, h: number) { this.data = d; this.width = w; this.height = h } })
    const out = composeRgba(discPhoto(6, 4), '#ffffff')
    const canvas = toCanvas(out)
    expect([canvas.width, canvas.height]).toEqual([6, 4])
    expect(put).toHaveBeenCalledTimes(1)
    expect((put.mock.calls[0][0] as { data: Uint8ClampedArray }).data).toBe(out.data)
  })
})

describe('the package keeps the background code out of the main entry', () => {
  const root = join(import.meta.dirname, '../..')
  it('src/index.ts does not import it, package.json has the ./background entry and an OPTIONAL peer onnxruntime-web, exactly pinned', () => {
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).not.toMatch(/background|onnxruntime/)
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(pkg.exports['./background']).toEqual({ types: './dist/background/index.d.ts', import: './dist/background/index.js' })
    expect(pkg.peerDependencies['onnxruntime-web']).toBe('1.30.0')
    expect(pkg.peerDependenciesMeta['onnxruntime-web']).toEqual({ optional: true })
    expect(pkg.devDependencies['onnxruntime-web']).toBe('1.30.0')
    expect(pkg.dependencies['onnxruntime-web']).toBeUndefined() // a tool that does not use it installs none of it
  })
  it('the version is 0.4.0 and the CHANGELOG has it', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
    expect(pkg.version).toBe('0.4.0')
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toMatch(/## 0\.4\.0/)
  })
})
