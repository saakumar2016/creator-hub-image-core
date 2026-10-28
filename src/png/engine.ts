// The two engines behind `PngEngine`: upng-js (MIT) for the palette and @jsquash/oxipng (Apache-2.0; oxipng itself is MIT)
// for the lossless pass. Used by the worker and by the Node tests; nothing else imports this file.
import { upngGlobalsReady } from './globals.ts'
import UPNG from 'upng-js'
// The single-threaded wasm-bindgen module of @jsquash/oxipng, not its `optimise`: that one switches to a multi-threaded
// build inside a Worker when the browser allows threads, which needs wasm-bindgen-rayon worker files and cross-origin isolation.
import initOxipng, { optimise as oxipng } from '@jsquash/oxipng/codec/pkg/squoosh_oxipng.js'
import type { PngEngine } from './core.ts'

const hasAlpha = (data: Uint8ClampedArray | Uint8Array, pixels: number): boolean => {
  for (let i = 0; i < pixels; i++) if (data[i * 4 + 3] !== 255) return true
  return false
}

/** What `initOxipng` takes: the compiled wasm module, its bytes, or a URL / Response. */
export type OxipngWasm = Parameters<typeof initOxipng>[0]

// Reading the flag keeps the import (and its order) even if a bundler drops side-effect-only imports.
if (!upngGlobalsReady) throw new Error('unreachable')

/**
 * UPNG's own quantizer mixes the alpha of nearby colours (a fully opaque pixel can come out at 253). For an image with any alpha
 * this keeps the three kinds of pixels apart: opaque (255), transparent (0) and the partly transparent ones are quantized
 * separately, so opaque stays 255 and transparent stays 0 exactly. The colour budget is split: one slot for transparent, a quarter
 * (8 to 64) for the partly transparent ones, the rest for the opaque ones. The merged result has at most `colors` colours, so UPNG
 * writes it as an indexed PNG (lossless pass, cnum 0). Uses `UPNG.quantize`, the function `UPNG.encode` calls itself (not in its README;
 * the version is pinned and a test covers it).
 */
function encodeWithAlpha(data: Uint8ClampedArray | Uint8Array, width: number, height: number, colors: number): Uint8Array {
  const pixels = width * height
  const source = new Uint32Array(pixels)
  new Uint8Array(source.buffer).set(data.subarray(0, pixels * 4))
  const alphaOf = (value: number) => value >>> 24 // little-endian RGBA in a Uint32: alpha is the top byte
  let solid = 0
  let partial = 0
  let clear = 0
  for (let i = 0; i < pixels; i++) {
    const alpha = alphaOf(source[i])
    if (alpha === 255) solid++
    else if (alpha === 0) clear++
    else partial++
  }
  const budget = Math.max(2, colors - (clear > 0 ? 1 : 0))
  const partialColors = partial === 0 ? 0 : solid === 0 ? budget : Math.max(8, Math.min(budget >> 2, 64))
  const solidColors = Math.max(1, budget - partialColors)
  const solidList = new Uint32Array(solid)
  const partialList = new Uint32Array(partial)
  let s = 0
  let p = 0
  for (let i = 0; i < pixels; i++) {
    const alpha = alphaOf(source[i])
    if (alpha === 255) solidList[s++] = source[i]
    else if (alpha !== 0) partialList[p++] = source[i]
  }
  const quantize = (list: Uint32Array, count: number): Uint32Array => (list.length === 0 ? list : new Uint32Array(UPNG.quantize([list.buffer as ArrayBuffer], count, false).bufs[0]))
  const solidOut = quantize(solidList, solidColors)
  const partialOut = quantize(partialList, Math.max(1, partialColors))
  const merged = new Uint32Array(pixels) // transparent pixels stay 0 (0, 0, 0, 0)
  s = 0
  p = 0
  for (let i = 0; i < pixels; i++) {
    const alpha = alphaOf(source[i])
    if (alpha === 255) merged[i] = (solidOut[s++] | 0xff000000) >>> 0
    else if (alpha !== 0) merged[i] = partialOut[p++]
  }
  return new Uint8Array(UPNG.encode([merged.buffer as ArrayBuffer], width, height, 0))
}

let ready: Promise<unknown> | null = null

/** Loads the oxipng wasm once and returns the engine. */
export async function createEngine(wasm: OxipngWasm): Promise<PngEngine> {
  ready ??= initOxipng(wasm)
  await ready
  return {
    encode(data, width, height, colors) {
      if (colors > 0 && hasAlpha(data, width * height)) return encodeWithAlpha(data, width, height, colors)
      const copy = new Uint8Array(data.byteLength)
      copy.set(data) // UPNG takes an ArrayBuffer and reads all of it
      return new Uint8Array(UPNG.encode([copy.buffer], width, height, colors))
    },
    optimise(png, level) {
      // interlace off (it makes the file bigger); optimiseAlpha off: transparent pixels keep their colour (no change of what a viewer shows)
      return oxipng(png, level, false, false)
    },
  }
}
