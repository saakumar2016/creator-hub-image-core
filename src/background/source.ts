// Turns what the caller gives (pixels, a bitmap, a canvas, an image element) into plain RGBA pixels at the photo's own size, and a cut-out back into a canvas.
import { BACKGROUND_MAX_PIXELS } from './types.ts'
import type { Cutout, ImageInput, RgbaImage } from './types.ts'

const isPixels = (image: ImageInput): image is RgbaImage => 'data' in image && 'width' in image && 'height' in image

/** Plain pixels from any input (read as sRGB). Throws a `RangeError` for an empty picture or one over `BACKGROUND_MAX_PIXELS` (25 MP). */
export function toRgba(image: ImageInput): RgbaImage {
  let result: RgbaImage
  if (isPixels(image)) result = image
  else {
    const width = 'naturalWidth' in image ? image.naturalWidth : image.width
    const height = 'naturalHeight' in image ? image.naturalHeight : image.height
    if (!(width > 0 && height > 0)) throw new RangeError('The image has no size (it is not loaded yet, or it is an SVG without a size)')
    check(width, height)
    const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!ctx) throw new Error('No 2D canvas is available to read the picture')
    ctx.drawImage(image as CanvasImageSource, 0, 0)
    const read = ctx.getImageData(0, 0, width, height)
    result = { data: read.data, width, height }
  }
  check(result.width, result.height)
  if (result.data.length < result.width * result.height * 4) throw new RangeError('The image must be RGBA with width × height × 4 bytes')
  return result
}

function check(width: number, height: number): void {
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) throw new RangeError('The image must have a width and a height')
  if (width * height > BACKGROUND_MAX_PIXELS) throw new RangeError(`The image has ${width * height} pixels; the limit is ${BACKGROUND_MAX_PIXELS}`)
}

/** A canvas with these pixels on it. */
export function toCanvas(image: Cutout): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })
  if (!ctx) throw new Error('No 2D canvas is available')
  ctx.putImageData(new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0)
  return canvas
}
