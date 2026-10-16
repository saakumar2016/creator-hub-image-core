// Decode and encode in the browser, shared by the Creator Hub image tools. Everything happens in
// the tab: a file is decoded with createImageBitmap (EXIF orientation applied) and a canvas is
// encoded with canvas.toBlob. Nothing is uploaded. The drawing itself (resize, crop, fit) stays
// in each tool.
import { LOSSY_QUALITY, type ImageType } from './limits.ts'

/** The decoded image with its displayed size (EXIF orientation applied by the browser). */
export type DecodedImage = { bitmap: ImageBitmap; width: number; height: number }

export class ImageDecodeError extends Error {}
/** The browser cannot encode the requested format (canvas.toBlob gave another type). */
export class UnsupportedOutputError extends Error {}
/** Encoding failed (e.g. a canvas too large for the device) or no 2D canvas is available. */
export class EncodeError extends Error {}

export async function decodeImage(file: Blob): Promise<DecodedImage> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { bitmap, width: bitmap.width, height: bitmap.height }
  } catch (error) {
    throw new ImageDecodeError(String(error))
  }
}

export type CanvasLike = Pick<HTMLCanvasElement, 'width' | 'height' | 'getContext' | 'toBlob'>
export const createCanvas = (): CanvasLike => document.createElement('canvas')

/** JPG has no transparency: transparent pixels would turn black, so paint white first. */
export function fillWhite(context: Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>, width: number, height: number) {
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
}

/**
 * Encodes the canvas as `type`; `quality` (0–1) applies to JPG and WebP. A browser that cannot
 * write the format falls back to PNG instead of failing: that is an UnsupportedOutputError.
 */
export async function encodeCanvas(canvas: Pick<CanvasLike, 'width' | 'height' | 'toBlob'>, type: ImageType, quality: number = LOSSY_QUALITY): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, type === 'image/png' ? undefined : quality))
  if (!blob) throw new EncodeError(`Could not encode a ${canvas.width} × ${canvas.height} image`)
  if (blob.type !== type) throw new UnsupportedOutputError(`Requested ${type}, got ${blob.type}`)
  return blob
}

/** Whether this browser can write `type` (e.g. WebP), by encoding a 1 × 1 canvas. */
export async function canEncode(type: ImageType, canvasFactory: () => CanvasLike = createCanvas): Promise<boolean> {
  const canvas = canvasFactory()
  canvas.width = 1
  canvas.height = 1
  try {
    await encodeCanvas(canvas, type)
    return true
  } catch {
    return false
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
