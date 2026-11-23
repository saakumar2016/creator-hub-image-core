// Optional: runs the REAL model (u2netp) in Node with onnxruntime-web, on a made-up photo (a coloured round shape on another colour, drawn in code).
// Set U2NETP_PATH to the model file to run it (the shell repository holds it); without it this file is skipped, so the package carries no model.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cutOut, createSession, type OrtLike } from './engine.ts'
import { discPhoto, RED } from './fixtures.ts'

const path = process.env.U2NETP_PATH
const alphaAt = (c: { data: Uint8ClampedArray; width: number }, x: number, y: number) => c.data[(y * c.width + x) * 4 + 3]

describe.skipIf(!path)('the real u2netp model (U2NETP_PATH)', () => {
  it('finds the round shape: the middle is opaque and keeps its colour, the corners are transparent', async () => {
    const ort = (await import('onnxruntime-web/wasm')) as unknown as OrtLike
    const dist = join(import.meta.dirname, '../../node_modules/onnxruntime-web/dist/')
    const session = await createSession(ort, new Uint8Array(readFileSync(path!)), pathToFileURL(dist).href)
    for (const [w, h] of [[600, 400], [400, 600]] as const) {
      const photo = discPhoto(w, h)
      const cutout = await cutOut(ort, session, photo)
      expect([cutout.width, cutout.height]).toEqual([w, h])
      expect(alphaAt(cutout, w >> 1, h >> 1), `${w}×${h} middle`).toBe(255)
      expect([...cutout.data.slice(((h >> 1) * w + (w >> 1)) * 4, ((h >> 1) * w + (w >> 1)) * 4 + 3)]).toEqual(RED)
      for (const [x, y] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]]) expect(alphaAt(cutout, x, y), `${w}×${h} corner ${x},${y}`).toBe(0)
    }
  }, 120_000)
})
