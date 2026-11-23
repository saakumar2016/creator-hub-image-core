// The pure part of removing a background: numbers in, numbers out, no canvas, no DOM, no network. The worker, the main-thread fallback and the tests all use it.
// Model: U²-Net small (u2netp), input 1 × 3 × 320 × 320, output 1 × 1 × 320 × 320 (the first output, a saliency mask).
import type { Cutout, RgbaImage } from './types.ts'

export const MODEL_SIZE = 320
// The values rembg (the reference use of this model) feeds it: the picture is divided by its largest value, then normalised with the ImageNet mean and deviation.
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

/**
 * Resizes RGBA pixels to `toWidth` × `toHeight` by area averaging (each new pixel is the weighted mean of the source pixels it covers: no aliasing when
 * the photo is much bigger than the model's input; a smaller photo is stretched smoothly). Colour channels are averaged with the pixels' alpha as weight,
 * so a see-through pixel does not pull its colour into its neighbours.
 */
export function resizeRgba(image: RgbaImage, toWidth: number, toHeight: number): Uint8ClampedArray {
  const { data, width, height } = image
  const xs = spans(width, toWidth)
  const ys = spans(height, toHeight)
  // pass 1: horizontal, to toWidth × height, premultiplied floats (r·a, g·a, b·a, a)
  const mid = new Float32Array(toWidth * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < toWidth; x++) {
      const { from, to, weights } = xs[x]
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = from; k < to; k++) {
        const w = weights[k - from]
        const at = (y * width + k) * 4
        const alpha = data[at + 3] / 255
        r += data[at] * alpha * w
        g += data[at + 1] * alpha * w
        b += data[at + 2] * alpha * w
        a += alpha * w
      }
      const out = (y * toWidth + x) * 4
      mid[out] = r
      mid[out + 1] = g
      mid[out + 2] = b
      mid[out + 3] = a
    }
  }
  // pass 2: vertical
  const out = new Uint8ClampedArray(toWidth * toHeight * 4)
  for (let y = 0; y < toHeight; y++) {
    const { from, to, weights } = ys[y]
    for (let x = 0; x < toWidth; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = from; k < to; k++) {
        const w = weights[k - from]
        const at = (k * toWidth + x) * 4
        r += mid[at] * w
        g += mid[at + 1] * w
        b += mid[at + 2] * w
        a += mid[at + 3] * w
      }
      const o = (y * toWidth + x) * 4
      if (a > 0) {
        out[o] = r / a
        out[o + 1] = g / a
        out[o + 2] = b / a
      }
      out[o + 3] = a * 255
    }
  }
  return out
}

type Span = { from: number; to: number; weights: Float32Array }
/** For each of `to` new pixels: the range of source pixels it covers (of `from` in all) and how much of each, summing to 1. */
function spans(source: number, target: number): Span[] {
  const result: Span[] = []
  const scale = source / target
  for (let i = 0; i < target; i++) {
    const start = i * scale
    const end = (i + 1) * scale
    let first: number
    let last: number
    if (scale >= 1) {
      first = Math.floor(start)
      last = Math.min(source, Math.ceil(end))
    } else {
      // stretching: look at the source pixel under the centre and its neighbour (linear), so the picture is smooth
      const centre = (i + 0.5) * scale - 0.5
      first = Math.max(0, Math.min(source - 1, Math.floor(centre)))
      last = Math.min(source, first + 2)
    }
    const weights = new Float32Array(last - first)
    let sum = 0
    for (let k = first; k < last; k++) {
      let w: number
      if (scale >= 1) w = Math.min(end, k + 1) - Math.max(start, k)
      else w = Math.max(0, 1 - Math.abs(k - ((i + 0.5) * scale - 0.5)))
      weights[k - first] = Math.max(0, w)
      sum += weights[k - first]
    }
    if (sum <= 0) weights[0] = sum = 1
    for (let k = 0; k < weights.length; k++) weights[k] /= sum
    result.push({ from: first, to: last, weights })
  }
  return result
}

/** The model's input from the picture resized to 320 × 320: planar RGB floats (1 × 3 × 320 × 320). A see-through pixel counts as white. */
export function makeInput(rgba320: Uint8ClampedArray): Float32Array {
  const plane = MODEL_SIZE * MODEL_SIZE
  const input = new Float32Array(3 * plane)
  let max = 0
  for (let i = 0; i < plane; i++) {
    const alpha = rgba320[i * 4 + 3] / 255
    for (let c = 0; c < 3; c++) {
      const v = rgba320[i * 4 + c] * alpha + 255 * (1 - alpha)
      input[c * plane + i] = v
      if (v > max) max = v
    }
  }
  const divisor = max > 0 ? max : 1
  for (let c = 0; c < 3; c++) for (let i = 0; i < plane; i++) input[c * plane + i] = (input[c * plane + i] / divisor - MEAN[c]) / STD[c]
  return input
}

/** The model's output stretched to 0…1 (the smallest value 0, the largest 1), as rembg does. A flat output (all values equal) gives 0 everywhere. */
export function normaliseMask(output: ArrayLike<number>): Float32Array {
  const mask = new Float32Array(output.length)
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < output.length; i++) {
    const v = output[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  const range = max - min
  if (!(range > 1e-6)) return mask
  for (let i = 0; i < output.length; i++) mask[i] = (output[i] - min) / range
  return mask
}

/** Resizes a mask to `width` × `height` with bilinear interpolation (smooth, no blocks). */
export function upscaleMask(mask: Float32Array, fromWidth: number, fromHeight: number, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height)
  const sx = fromWidth / width
  const sy = fromHeight / height
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, Math.min(fromHeight - 1, (y + 0.5) * sy - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(fromHeight - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, Math.min(fromWidth - 1, (x + 0.5) * sx - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(fromWidth - 1, x0 + 1)
      const tx = fx - x0
      const top = mask[y0 * fromWidth + x0] * (1 - tx) + mask[y0 * fromWidth + x1] * tx
      const bottom = mask[y1 * fromWidth + x0] * (1 - tx) + mask[y1 * fromWidth + x1] * tx
      out[y * width + x] = top * (1 - ty) + bottom * ty
    }
  }
  return out
}

/** The feather's radius in pixels for a photo: about 1/700 of its longer side, at least 1 (3 px on 1500 × 2000). */
export const featherRadius = (width: number, height: number): number => Math.max(1, Math.round(Math.max(width, height) / 700))

/**
 * A soft edge: a box blur of the mask, horizontal then vertical (running sums, so it costs the same at any radius). Inside the cut-out (all 1) and far outside (all 0)
 * nothing changes. The blurred mask is written back into `mask` (one scratch array, not two: a big photo needs the memory) and returned.
 */
export function feather(mask: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius < 1) return mask
  const tmp = new Float32Array(mask.length)
  const span = 2 * radius + 1
  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let k = -radius; k <= radius; k++) sum += mask[row + Math.min(width - 1, Math.max(0, k))]
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / span
      sum += mask[row + Math.min(width - 1, x + radius + 1)] - mask[row + Math.max(0, x - radius)]
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let k = -radius; k <= radius; k++) sum += tmp[Math.min(height - 1, Math.max(0, k)) * width + x]
    for (let y = 0; y < height; y++) {
      mask[y * width + x] = sum / span
      sum += tmp[Math.min(height - 1, y + radius + 1) * width + x] - tmp[Math.max(0, y - radius) * width + x]
    }
  }
  return mask
}

/** The photo's pixels with the mask as alpha (0 = background, 255 = kept). A photo that already had see-through parts keeps them (the two alphas multiply). */
export function applyAlpha(image: RgbaImage, mask: Float32Array): Cutout {
  const { width, height } = image
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = image.data[i * 4]
    data[i * 4 + 1] = image.data[i * 4 + 1]
    data[i * 4 + 2] = image.data[i * 4 + 2]
    data[i * 4 + 3] = Math.round(mask[i] * image.data[i * 4 + 3])
  }
  return { data, width, height }
}

/** What goes into the model for this photo. */
export const prepare = (image: RgbaImage): Float32Array => makeInput(resizeRgba(image, MODEL_SIZE, MODEL_SIZE))

/** The cut-out at the photo's own size from the model's raw output (320 × 320 values). */
export function finish(image: RgbaImage, output: ArrayLike<number>): Cutout {
  const mask = upscaleMask(normaliseMask(output), MODEL_SIZE, MODEL_SIZE, image.width, image.height)
  return applyAlpha(image, feather(mask, image.width, image.height, featherRadius(image.width, image.height)))
}

/** `#rgb` or `#rrggbb` as three numbers. Anything else throws a `RangeError`. */
export function parseHex(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) throw new RangeError(`The background must be 'transparent' or a hex colour like #ffffff, not ${JSON.stringify(color)}`)
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

/**
 * The cut-out laid on a background: 'transparent' keeps it as it is (a copy), a hex colour fills what is see-through (the edge blends into the colour) and
 * the result is fully opaque.
 */
export function composeRgba(cutout: Cutout | RgbaImage, background: 'transparent' | string): Cutout {
  const { width, height } = cutout
  const data = new Uint8ClampedArray(width * height * 4)
  if (background === 'transparent') {
    data.set(cutout.data.subarray(0, width * height * 4))
    return { data, width, height }
  }
  const [br, bg, bb] = parseHex(background)
  for (let i = 0; i < width * height; i++) {
    const a = cutout.data[i * 4 + 3] / 255
    data[i * 4] = cutout.data[i * 4] * a + br * (1 - a)
    data[i * 4 + 1] = cutout.data[i * 4 + 1] * a + bg * (1 - a)
    data[i * 4 + 2] = cutout.data[i * 4 + 2] * a + bb * (1 - a)
    data[i * 4 + 3] = 255
  }
  return { data, width, height }
}
