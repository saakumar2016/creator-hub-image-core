// File names written by the Creator Hub image tools: "<name>-<W>x<H>.<ext>", numbered photos
// "<name>-<k>.<ext>", and a user's file name prefix (letters and numbers of any script).
// Pure functions, no browser APIs.
import { EXTENSION, type ImageType } from './limits.ts'

/** A prefix is at most this many characters. */
export const PREFIX_MAX = 60

/** "beach sunset.jpeg" → "beach sunset-1280x960.jpg". */
export function outputFileName(name: string, type: ImageType, width: number, height: number): string {
  const base = name.replace(/\.[^./\\]+$/, '').trim() || 'image'
  return `${base}-${width}x${height}.${EXTENSION[type]}`
}

/** Split collage: photo k (1-based) of "maroon lookbook.jpg" → "maroon lookbook-2.jpg". */
export function splitFileName(name: string, type: ImageType, k: number): string {
  const base = name.replace(/\.[^./\\]+$/, '').trim() || 'image'
  return `${base}-${k}.${EXTENSION[type]}`
}

// Letters (with their combining marks, e.g. Devanagari vowel signs) and numbers of any script,
// "-" and "_" are kept; everything else becomes "-".
const DISALLOWED = /[^\p{L}\p{M}\p{N}_-]+/gu

/** What the prefix field keeps while typing: no trimming, so "a-" can be followed by "b". */
export function typedPrefix(value: string): string {
  return value.replace(DISALLOWED, '-').replace(/-{2,}/g, '-').replace(/_{2,}/g, '_').slice(0, PREFIX_MAX)
}

/** The prefix used in file names: as typed, then trimmed of "-"/"_" at both ends; empty → "image". */
export function sanitizePrefix(value: string): string {
  const trimmed = typedPrefix(value).replace(/^[-_]+|[-_]+$/g, '')
  return trimmed || 'image'
}

/** Default prefix: the original file name without its extension. */
export const defaultPrefix = (fileName: string) => sanitizePrefix(fileName.replace(/\.[^./\\]+$/, ''))

/** "<prefix>-<k>.<ext>" (k is 1-based). */
export const outputName = (prefix: string, k: number, type: ImageType) => `${sanitizePrefix(prefix)}-${k}.${EXTENSION[type]}`
export const zipName = (prefix: string) => `${sanitizePrefix(prefix)}.zip`

