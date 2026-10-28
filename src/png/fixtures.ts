// Small generated images for the PNG tests (no binary files in the repo). Deterministic: a fixed pseudo-random sequence.
import type { RgbaImage } from './types.ts'

/** A small deterministic random source (mulberry32). */
export function random(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const make = (width: number, height: number): RgbaImage => ({ data: new Uint8ClampedArray(width * height * 4), width, height })

/** A photo-like image: smooth colour fields with a little noise, many thousands of colours, opaque. */
export function photoLike(width = 240, height = 160, seed = 1): RgbaImage {
  const image = make(width, height)
  const rnd = random(seed)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const u = x / width
      const v = y / height
      image.data[o] = 120 + 110 * Math.sin(u * 5 + v * 2) + rnd() * 14
      image.data[o + 1] = 110 + 100 * Math.cos(v * 4 - u) + rnd() * 14
      image.data[o + 2] = 130 + 90 * Math.sin((u + v) * 6) + rnd() * 14
      image.data[o + 3] = 255
    }
  }
  return image
}

/** An opaque image with exactly `colours` different colours (blocks), like a flat UI or a diagram. */
export function flatColours(colours = 83, width = 160, height = 120): RgbaImage {
  const image = make(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = (Math.floor(x / 8) + Math.floor(y / 8) * 20) % colours
      const o = (y * width + x) * 4
      image.data[o] = (k * 37) % 256
      image.data[o + 1] = (k * 91 + 13) % 256
      image.data[o + 2] = (k * 53 + 101) % 256
      image.data[o + 3] = 255
    }
  }
  return image
}

/** A logo-like image with a transparent background, a soft shadow (partly transparent) and an opaque disc with a gradient. */
export function transparentLogo(size = 128): RgbaImage {
  const image = make(size, size)
  const c = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      const d = Math.hypot(x - c, y - c)
      const disc = d < size * 0.3
      const shadowD = Math.hypot(x - c - 6, y - c - 8)
      image.data[o] = disc ? 30 + (x / size) * 200 : 20
      image.data[o + 1] = disc ? 110 + (y / size) * 80 : 30
      image.data[o + 2] = disc ? 250 - (x / size) * 120 : 80
      image.data[o + 3] = disc ? 255 : shadowD < size * 0.42 ? Math.round(140 * (1 - shadowD / (size * 0.42))) : 0
    }
  }
  return image
}

/** The alpha channel of an RGBA buffer, for comparing before and after. */
export const alphaOf = (data: Uint8ClampedArray | Uint8Array): Uint8Array => {
  const out = new Uint8Array(data.length / 4)
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3]
  return out
}

/**
 * A logo with soft edges like a real exported one: an opaque disc whose edge fades out over a few pixels, a ring of almost opaque
 * pixels (alpha 250-254) inside the edge, a blurred shadow and a transparent background. UPNG's plain quantizer lowers the alpha of
 * some fully opaque pixels of an image like this (the PNG compressor must not).
 */
export function softEdgeLogo(size = 160): RgbaImage {
  const image = make(size, size)
  const c = size / 2
  const rnd = random(5)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      const d = Math.hypot(x - c, y - c)
      const r = size * 0.32
      const edge = Math.min(1, Math.max(0, (r + 5 - d) / 10)) // 1 inside, 0 outside, a 10 px ramp
      const shadow = Math.max(0, 1 - Math.hypot(x - c - 5, y - c - 9) / (size * 0.46))
      let alpha = d < r - 5 ? (d > r - 9 ? 250 + Math.floor(rnd() * 5) : 255) : Math.round(255 * edge)
      if (alpha === 0) alpha = Math.round(120 * shadow * shadow)
      image.data[o] = d < r ? 40 + (x / size) * 190 + rnd() * 6 : 15
      image.data[o + 1] = d < r ? 90 + (y / size) * 110 + rnd() * 6 : 20
      image.data[o + 2] = d < r ? 240 - (x / size) * 140 : 60
      image.data[o + 3] = alpha
    }
  }
  return image
}
