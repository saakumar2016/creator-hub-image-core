// Limits and validation shared by the Creator Hub image tools: what is accepted and what is
// written. Keep the limits identical to the shell's "About this tool" copy.
// No browser APIs here, so everything is unit-tested directly.

/**
 * Limits shown in the shell's "About this tool" (CLAUDE.md §3; confirmed by the user 2026-10-15,
 * option 2). They apply to the source image and to the cropped output.
 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_DIMENSION = 10_000
/**
 * Width × height: 50 megapixels. A decoded image takes 4 bytes per pixel and a resize keeps the
 * source bitmap and the output canvas in memory, so this keeps one bitmap at about 200 MB.
 */
export const MAX_PIXELS = 50_000_000
export const MAX_MEGAPIXELS = MAX_PIXELS / 1_000_000

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type ImageType = (typeof IMAGE_TYPES)[number]

/** Output format: the source's own format, or one of the supported types. */
export type OutputChoice = 'original' | ImageType

export const FORMAT_LABEL: Record<ImageType, string> = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP' }
/** File extension written for each type. */
export const EXTENSION: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** Quality for the lossy formats (JPG, WebP). */
export const LOSSY_QUALITY = 0.92

export type FileProblem = 'type' | 'size' | 'empty'

export const isImageType = (type: string): type is ImageType => (IMAGE_TYPES as readonly string[]).includes(type)

/** Checks a chosen file before it is read. */
export function checkFile(file: Pick<File, 'type' | 'size'>): FileProblem | null {
  if (!isImageType(file.type)) return 'type'
  if (file.size === 0) return 'empty'
  if (file.size > MAX_FILE_BYTES) return 'size'
  return null
}

/** Width × height within MAX_PIXELS (the side limit is checked separately). */
export const withinArea = (width: number, height: number) => width * height <= MAX_PIXELS

export type SizeProblem = 'dimensions' | 'area'

/** A decoded source image: a side over MAX_DIMENSION, or more than MAX_PIXELS in total. */
export function checkImageSize(width: number, height: number): SizeProblem | null {
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) return 'dimensions'
  if (!withinArea(width, height)) return 'area'
  return null
}

export const outputType = (choice: OutputChoice, source: ImageType): ImageType => (choice === 'original' ? source : choice)

/** File size for people: "820 KB", "3.2 MB". */
export function formatBytes(bytes: number, locale: string): string {
  const format = (value: number, digits: number) => value.toLocaleString(locale, { maximumFractionDigits: digits })
  if (bytes < 1024) return `${format(bytes, 0)} B`
  if (bytes < 1024 * 1024) return `${format(Math.max(1, Math.round(bytes / 1024)), 0)} KB`
  return `${format(bytes / (1024 * 1024), 1)} MB`
}
