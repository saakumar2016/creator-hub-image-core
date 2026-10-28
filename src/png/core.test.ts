// @vitest-environment node
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import UPNG from 'upng-js'
import { OXIPNG_BEST_RATIO, countColours, runLadder, type PngEngine } from './core.ts'
import { createEngine } from './engine.ts'
import { alphaOf, flatColours, photoLike, softEdgeLogo, transparentLogo } from './fixtures.ts'
import { resolveOptions, type PngCompressOptions } from './types.ts'

// The real engines (UPNG and the oxipng wasm, read from node_modules), so the sizes are the real ones.
let engine: PngEngine
beforeAll(async () => {
  engine = await createEngine(readFileSync(new URL('../../node_modules/@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm', import.meta.url)))
})

const run = (image: Parameters<typeof runLadder>[0], options: PngCompressOptions = {}, wrapped: PngEngine = engine, hooks = {}) => runLadder(image, resolveOptions(options), wrapped, hooks)
const decode = (bytes: Uint8Array) => {
  const copy = bytes.slice().buffer
  const info = UPNG.decode(copy)
  return { info, rgba: new Uint8Array(UPNG.toRGBA8(info)[0]) }
}
/** What each rung gives in the end (raw → oxipng level 2), the oracle for the ladder tests. */
const finalSizes = async (image: ReturnType<typeof photoLike>) => {
  const out = new Map<number, number>()
  for (const colors of [256, 128, 64]) out.set(colors, (await engine.optimise(engine.encode(image.data, image.width, image.height, colors), 2)).length)
  return out
}

describe('countColours', () => {
  it('counts the different RGBA values and stops above the limit', () => {
    expect(countColours(flatColours(83).data)).toBe(83)
    expect(countColours(photoLike().data)).toBe(257) // more than 256: it stops at 257
    expect(countColours(new Uint8ClampedArray(16), 256)).toBe(1)
  })
  it('reads a buffer that does not start on a 4-byte boundary', () => {
    const odd = new Uint8Array(1 + 8 * 4)
    odd.set([1, 2, 3, 255, 1, 2, 3, 255, 9, 9, 9, 255], 1)
    expect(countColours(odd.subarray(1))).toBe(3)
  })
})

describe('runLadder: the colour ladder', () => {
  it('picks the HIGHEST colour count whose final size is at most the target', async () => {
    const image = photoLike()
    const sizes = await finalSizes(image)
    expect(sizes.get(256)!).toBeGreaterThan(sizes.get(128)!)
    expect(sizes.get(128)!).toBeGreaterThan(sizes.get(64)!)
    // a target that 128 and 64 meet but 256 does not → 128
    const t128 = Math.floor((sizes.get(256)! + sizes.get(128)!) / 2)
    const r128 = await run(image, { targetBytes: t128 })
    expect([r128.colors, r128.reachedTarget]).toEqual([128, true])
    expect(r128.bytes.length).toBe(sizes.get(128))
    // a target only 64 meets
    const r64 = await run(image, { targetBytes: Math.floor((sizes.get(128)! + sizes.get(64)!) / 2) })
    expect([r64.colors, r64.reachedTarget]).toEqual([64, true])
    // a target 256 already meets
    const r256 = await run(image, { targetBytes: sizes.get(256)! + 10 })
    expect([r256.colors, r256.reachedTarget]).toEqual([256, true])
    expect(r256.bytes.length).toBeLessThanOrEqual(sizes.get(256)!)
  })

  it('floor: a target nothing meets gives the 64-colour result with reachedTarget false; minColors raises the floor', async () => {
    const image = photoLike()
    const sizes = await finalSizes(image)
    const low = await run(image, { targetBytes: 500 })
    expect([low.colors, low.reachedTarget]).toEqual([64, false])
    expect(low.bytes.length).toBe(sizes.get(64))
    const floor128 = await run(image, { targetBytes: 500, minColors: 128 })
    expect([floor128.colors, floor128.reachedTarget]).toEqual([128, false])
    const floor256 = await run(image, { targetBytes: 500, minColors: 256 })
    expect([floor256.colors, floor256.reachedTarget]).toEqual([256, false])
  })

  it('without a target: one pass at 256 colours (one palette, one oxipng) and reachedTarget true', async () => {
    const progress: string[] = []
    const result = await run(photoLike(), {}, engine, { onProgress: (p: { stage: string; colors: number }) => progress.push(`${p.stage}:${p.colors}`) })
    expect(result.colors).toBe(256)
    expect(result.reachedTarget).toBe(true)
    expect(progress).toEqual(['quantize:256', 'optimize:256'])
  })

  it('does not run oxipng on a rung that cannot get under the target (the heuristic), but always on the last rung', async () => {
    const optimise = vi.fn(engine.optimise)
    const counting: PngEngine = { encode: engine.encode, optimise }
    const image = photoLike()
    await run(image, { targetBytes: 500 }, counting)
    expect(optimise).toHaveBeenCalledTimes(1) // 256 and 128 skipped, 64 is the last rung
    optimise.mockClear()
    const sizes = await finalSizes(image)
    await run(image, { targetBytes: sizes.get(64)! + 5 }, counting) // 256 and 128 are far above, 64 fits
    expect(optimise.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('the skip bound is safe: oxipng never saved more than the bound on the spike-like rungs', async () => {
    const image = photoLike()
    for (const colors of [256, 128, 64]) {
      const raw = engine.encode(image.data, image.width, image.height, colors)
      const optimised = await engine.optimise(raw, 2)
      expect(optimised.length / raw.length, `${colors} colours`).toBeGreaterThan(OXIPNG_BEST_RATIO)
    }
  })

  it('is deterministic: the same input and options give the same bytes', async () => {
    const image = photoLike()
    const a = await run(image, { targetBytes: 12_000 })
    const b = await run(image, { targetBytes: 12_000 })
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true)
  })

  it('level 1 and level 2 both work (level 1 is faster, level 2 not larger)', async () => {
    const image = photoLike()
    const l1 = await run(image, { level: 1 })
    const l2 = await run(image, { level: 2 })
    expect(l2.bytes.length).toBeLessThanOrEqual(l1.bytes.length)
  })
})

describe('runLadder: images that must stay as they are', () => {
  it('an image with 256 colours or fewer stays exact (every pixel equal) and keeps its own colour count', async () => {
    const image = flatColours(83)
    const result = await run(image)
    expect(result.colors).toBe(83)
    const { rgba } = decode(result.bytes)
    expect(Buffer.from(rgba).equals(Buffer.from(image.data))).toBe(true)
  })

  it('an exact image whose own palette is over the target is lowered, not left over', async () => {
    const image = flatColours(200)
    const exact = await run(image)
    expect(exact.colors).toBe(200)
    const lowered = await run(image, { targetBytes: Math.floor(exact.bytes.length / 3) })
    expect(lowered.colors).toBeLessThan(200)
  })

  it.each([['a logo with a shadow', transparentLogo], ['a logo with soft edges', softEdgeLogo]] as const)('alpha survives at every rung (%s): fully transparent pixels stay 0, fully opaque stay 255', async (_name, make) => {
    const image = make()
    const before = alphaOf(image.data)
    for (const minColors of [256, 128, 64] as const) {
      const result = await run(image, { targetBytes: 1, minColors })
      const decoded = decode(result.bytes)
      expect(decoded.info.ctype, 'an indexed PNG').toBe(3)
      const after = alphaOf(decoded.rgba)
      let zero = 0, zeroKept = 0, full = 0, fullKept = 0
      for (let i = 0; i < before.length; i++) {
        if (before[i] === 0) { zero++; if (after[i] === 0) zeroKept++ }
        if (before[i] === 255) { full++; if (after[i] === 255) fullKept++ }
      }
      expect(zero).toBeGreaterThan(500)
      expect(full).toBeGreaterThan(500)
      expect(zeroKept, `${minColors}: transparent`).toBe(zero)
      expect(fullKept, `${minColors}: opaque`).toBe(full)
      expect(result.colors).toBeLessThanOrEqual(256)
    }
  })

  it('why the alpha is kept apart: plain UPNG quantizing lowers the alpha of some fully opaque pixels of a soft-edged logo', () => {
    const image = softEdgeLogo()
    const plain = decode(new Uint8Array(UPNG.encode([image.data.slice().buffer], image.width, image.height, 64)))
    const before = alphaOf(image.data)
    const after = alphaOf(plain.rgba)
    let lowered = 0
    for (let i = 0; i < before.length; i++) if (before[i] === 255 && after[i] !== 255) lowered++
    expect(lowered).toBeGreaterThan(0) // if this ever fails, the split in engine.ts may no longer be needed
  })

  it('an image without any alpha takes the plain path (no split)', async () => {
    const image = photoLike()
    const result = await run(image, { targetBytes: 1 })
    expect(alphaOf(decode(result.bytes).rgba).every((a) => a === 255)).toBe(true)
  })
})

describe('runLadder: abort', () => {
  it('rejects with an AbortError between steps when the hook says so', async () => {
    let calls = 0
    await expect(run(photoLike(), { targetBytes: 500 }, engine, { aborted: () => ++calls > 1 })).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('resolveOptions', () => {
  it('fills the defaults and rejects values the ladder does not have', () => {
    expect(resolveOptions()).toEqual({ targetBytes: undefined, minColors: 64, level: 2 })
    expect(() => resolveOptions({ targetBytes: 0 })).toThrow(RangeError)
    expect(() => resolveOptions({ targetBytes: Number.NaN })).toThrow(RangeError)
    expect(() => resolveOptions({ minColors: 32 as 64 })).toThrow(RangeError)
    expect(() => resolveOptions({ level: 3 as 2 })).toThrow(RangeError)
  })
})
