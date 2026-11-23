import { describe, expect, it } from 'vitest'
import { applyAlpha, composeRgba, feather, featherRadius, finish, makeInput, MODEL_SIZE, normaliseMask, parseHex, prepare, resizeRgba, upscaleMask } from './core.ts'
import { BLUE, discMask, discPhoto, RED } from './fixtures.ts'

const at = (image: { data: Uint8ClampedArray | Uint8Array; width: number }, x: number, y: number) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]

describe('resizeRgba', () => {
  it('keeps a flat picture flat, at any size (down and up)', () => {
    const flat = { data: new Uint8ClampedArray(50 * 30 * 4).map((_, i) => [10, 120, 230, 255][i % 4]), width: 50, height: 30 }
    for (const [w, h] of [[7, 5], [320, 320], [100, 60]]) {
      const out = resizeRgba(flat, w, h)
      expect(out.length).toBe(w * h * 4)
      for (let i = 0; i < w * h; i++) expect([...out.slice(i * 4, i * 4 + 4)]).toEqual([10, 120, 230, 255])
    }
  })
  it('averages the pixels a new pixel covers (2 × 2 → 1)', () => {
    const image = { data: new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 100, 100, 100, 255]), width: 2, height: 2 }
    expect([...resizeRgba(image, 1, 1)]).toEqual([100, 100, 100, 255])
  })
  it('a see-through pixel does not pull its colour into its neighbour', () => {
    const image = { data: new Uint8ClampedArray([200, 40, 40, 255, 0, 0, 0, 0]), width: 2, height: 1 }
    expect([...resizeRgba(image, 1, 1)].slice(0, 3)).toEqual([200, 40, 40]) // not (100, 20, 20)
  })
  it('the disc photo shrunk to the model size keeps both colours in the right places', () => {
    const small = { data: resizeRgba(discPhoto(1500, 2000), MODEL_SIZE, MODEL_SIZE), width: MODEL_SIZE, height: MODEL_SIZE }
    expect(at(small, 160, 160).slice(0, 3)).toEqual(RED)
    expect(at(small, 3, 3).slice(0, 3)).toEqual(BLUE)
  })
})

describe('the model input', () => {
  it('is 1 × 3 × 320 × 320 floats, normalised the way the model expects (a white picture: (1 - mean) / std)', () => {
    const white = new Uint8ClampedArray(MODEL_SIZE * MODEL_SIZE * 4).fill(255)
    const input = makeInput(white)
    expect(input.length).toBe(3 * MODEL_SIZE * MODEL_SIZE)
    expect(input[0]).toBeCloseTo((1 - 0.485) / 0.229, 5)
    expect(input[MODEL_SIZE * MODEL_SIZE]).toBeCloseTo((1 - 0.456) / 0.224, 5)
    expect(input[2 * MODEL_SIZE * MODEL_SIZE]).toBeCloseTo((1 - 0.406) / 0.225, 5)
  })
  it('a black picture does not divide by zero', () => {
    const black = new Uint8ClampedArray(MODEL_SIZE * MODEL_SIZE * 4)
    for (let i = 0; i < black.length; i += 4) black[i + 3] = 255
    const input = makeInput(black)
    expect(input.every(Number.isFinite)).toBe(true)
  })
  it('prepare(photo) is that, from a photo of any size', () => {
    expect(prepare(discPhoto(123, 457)).length).toBe(3 * MODEL_SIZE * MODEL_SIZE)
  })
})

describe('the mask', () => {
  it('is stretched to 0…1; a flat output gives 0', () => {
    expect([...normaliseMask([2, 4, 6])]).toEqual([0, 0.5, 1])
    expect([...normaliseMask([3, 3, 3])]).toEqual([0, 0, 0])
  })
  it('is resized smoothly to the photo\'s size: the same value stays the same, a ramp stays a ramp', () => {
    const flat = upscaleMask(new Float32Array(4).fill(0.7), 2, 2, 9, 5)
    expect(flat.length).toBe(45)
    for (const v of flat) expect(v).toBeCloseTo(0.7, 6)
    const ramp = upscaleMask(new Float32Array([0, 1, 0, 1]), 2, 2, 8, 2)
    for (let x = 1; x < 8; x++) expect(ramp[x]).toBeGreaterThanOrEqual(ramp[x - 1]) // no steps back
  })
  it('feather: a hard edge becomes a soft ramp of about 2 r + 1 pixels; far inside stays 1 and far outside stays 0', () => {
    const w = 40
    const edge = new Float32Array(w * 5)
    for (let y = 0; y < 5; y++) for (let x = 20; x < w; x++) edge[y * w + x] = 1
    const soft = feather(edge, w, 5, 3)
    expect(soft[2 * w + 5]).toBe(0)
    expect(soft[2 * w + 35]).toBeCloseTo(1, 6)
    const ramp = [...soft.slice(2 * w + 16, 2 * w + 24)]
    expect(ramp.some((v) => v > 0.05 && v < 0.95)).toBe(true) // a soft edge
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeGreaterThanOrEqual(ramp[i - 1])
    expect(featherRadius(1500, 2000)).toBe(3)
    expect(featherRadius(100, 100)).toBe(1)
  })
})

describe('the cut-out of a photo (a stand-in model that finds the disc)', () => {
  for (const [w, h] of [[600, 400], [1500, 2000], [200, 300]] as const) {
    it(`${w} × ${h}: the middle of the shape is opaque and keeps its colour, the corners are transparent, the size is the photo's`, () => {
      const photo = discPhoto(w, h)
      const cutout = finish(photo, discMask(w, h))
      expect(cutout.width).toBe(w)
      expect(cutout.height).toBe(h)
      expect(at(cutout, w >> 1, h >> 1)).toEqual([...RED, 255])
      for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [5, h >> 1], [w - 6, h >> 1]]) expect(at(cutout, x, y)[3], `${x},${y}`).toBe(0)
      // the edge is soft: some pixels between 0 and 255, and they sit where the disc's edge is
      const r = 0.3 * Math.min(w, h)
      let soft = 0
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const a = cutout.data[(y * w + x) * 4 + 3]
          if (a > 0 && a < 255) {
            soft++
            const d = Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2)
            expect(Math.abs(d - r)).toBeLessThan(0.1 * Math.min(w, h))
          }
        }
      expect(soft).toBeGreaterThan(10)
    })
  }
  it('the colours are the photo\'s own (nothing is recoloured); only alpha changes', () => {
    const photo = discPhoto(300, 200)
    const cutout = applyAlpha(photo, new Float32Array(300 * 200).fill(0.5))
    for (let i = 0; i < 300 * 200; i++) expect([...cutout.data.slice(i * 4, i * 4 + 3)]).toEqual([...photo.data.slice(i * 4, i * 4 + 3)])
    expect(cutout.data[3]).toBe(128)
  })
  it('a photo that already has see-through parts keeps them', () => {
    const photo = { data: new Uint8ClampedArray([10, 20, 30, 0]), width: 1, height: 1 }
    expect(applyAlpha(photo, new Float32Array([1])).data[3]).toBe(0)
  })
})

describe('composeRgba (a cut-out on a background)', () => {
  const cutout = { data: new Uint8ClampedArray([200, 40, 40, 255, 10, 20, 30, 0, 200, 40, 40, 128]), width: 3, height: 1 }
  it("'transparent' is a copy as it is", () => {
    const out = composeRgba(cutout, 'transparent')
    expect([...out.data]).toEqual([...cutout.data])
    expect(out.data).not.toBe(cutout.data)
  })
  it('a hex colour fills the see-through parts, keeps the solid ones, blends the soft edge, and is fully opaque', () => {
    const out = composeRgba(cutout, '#ffffff')
    expect(at(out, 0, 0)).toEqual([200, 40, 40, 255])
    expect(at(out, 1, 0)).toEqual([255, 255, 255, 255])
    const mix = at(out, 2, 0)
    expect(mix[3]).toBe(255)
    expect(mix[0]).toBeGreaterThan(200)
    expect(mix[0]).toBeLessThan(255)
    expect(at(composeRgba(cutout, '#102030'), 1, 0)).toEqual([16, 32, 48, 255])
    expect(at(composeRgba(cutout, '#abc'), 1, 0)).toEqual([0xaa, 0xbb, 0xcc, 255]) // the short form
    expect(at(composeRgba(cutout, ' #FFF '), 1, 0)).toEqual([255, 255, 255, 255])
  })
  it('the cut-out of the disc photo on pink: the corner is pink, the middle is the photo\'s red', () => {
    const photo = discPhoto(200, 100)
    const out = composeRgba(finish(photo, discMask(200, 100)), '#f5c6d6')
    expect(at(out, 0, 0)).toEqual([0xf5, 0xc6, 0xd6, 255])
    expect(at(out, 100, 50)).toEqual([...RED, 255])
  })
  it('anything but transparent or a hex colour is a RangeError', () => {
    for (const bad of ['red', '#12345', '#gggggg', '', 'rgb(1,2,3)', '#1234567']) expect(() => composeRgba(cutout, bad), bad).toThrow(RangeError)
    expect(parseHex('#0a0B0c')).toEqual([10, 11, 12])
  })
})
