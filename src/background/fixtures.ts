// Test helpers: a made-up photo (a red round shape on a blue background, drawn in code: no face, no real photo) and a stand-in for the model.
import { MODEL_SIZE } from './core.ts'
import type { OrtLike, SessionLike } from './engine.ts'
import type { RgbaImage } from './types.ts'

export const RED = [200, 40, 40]
export const BLUE = [40, 90, 200]

/** A `width` × `height` photo: a blue background and a red disc in the middle (radius 30 % of the shorter side). */
export function discPhoto(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  const r = 0.3 * Math.min(width, height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inside = (x + 0.5 - width / 2) ** 2 + (y + 0.5 - height / 2) ** 2 <= r * r
      data.set([...(inside ? RED : BLUE), 255], (y * width + x) * 4)
    }
  return { data, width, height }
}

/**
 * What a good model says about `discPhoto(width, height)`: high in the disc, low outside (320 × 320 raw values, like u2netp's output). The model sees the photo
 * squeezed to a square, so the disc is an ellipse there.
 */
export function discMask(width = 320, height = 320): Float32Array {
  const out = new Float32Array(MODEL_SIZE * MODEL_SIZE)
  const r = 0.3 * Math.min(width, height)
  const rx = (r * MODEL_SIZE) / width
  const ry = (r * MODEL_SIZE) / height
  for (let y = 0; y < MODEL_SIZE; y++)
    for (let x = 0; x < MODEL_SIZE; x++) out[y * MODEL_SIZE + x] = ((x + 0.5 - MODEL_SIZE / 2) / rx) ** 2 + ((y + 0.5 - MODEL_SIZE / 2) / ry) ** 2 <= 1 ? 0.97 : 0.01
  return out
}

/** A stand-in for onnxruntime-web whose session answers every photo with `discMask` of a `width` × `height` photo. `created` counts the sessions made. */
export function fakeOrt(width = 320, height = 320): { ort: OrtLike; created: { count: number }; runs: { count: number } } {
  const created = { count: 0 }
  const runs = { count: 0 }
  const session: SessionLike = {
    inputNames: ['input.1'],
    outputNames: ['d0'],
    async run() {
      runs.count++
      return { d0: { data: discMask(width, height) } }
    },
  }
  const ort: OrtLike = {
    env: { wasm: {} },
    InferenceSession: {
      async create() {
        created.count++
        return session
      },
    },
    Tensor: class {
      type: string
      data: Float32Array
      dims: number[]
      constructor(type: string, data: Float32Array, dims: number[]) {
        this.type = type
        this.data = data
        this.dims = dims
      }
    } as unknown as OrtLike['Tensor'],
  }
  return { ort, created, runs }
}
