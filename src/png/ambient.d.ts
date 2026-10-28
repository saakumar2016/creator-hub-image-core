// Declarations for what Vite adds (the consumer's bundler resolves these imports) and for upng-js, which ships no types.
declare module '*?worker&inline' {
  const WorkerConstructor: new () => Worker
  export default WorkerConstructor
}
declare module '*.wasm?url' {
  const url: string
  export default url
}
declare module 'upng-js' {
  const UPNG: {
    /** `frames`: RGBA frames (ArrayBuffers); `colors` 0 = lossless, N = at most N colours. Returns the PNG file. */
    encode(frames: ArrayBuffer[], width: number, height: number, colors: number, delays?: number[]): ArrayBuffer
    /** The quantizer `encode` uses: RGBA frames in, the same frames with at most `colors` colours out (`roundAlpha`: alpha to 0 or 255, for GIF). */
    quantize(frames: ArrayBuffer[], colors: number, roundAlpha: boolean): { bufs: ArrayBuffer[] }
    /** Reads a PNG file. `ctype` 3 = palette. */
    decode(file: ArrayBuffer): { width: number; height: number; ctype: number; depth: number }
    /** RGBA frames (ArrayBuffers) of a decoded image. */
    toRGBA8(image: { width: number; height: number; ctype: number; depth: number }): ArrayBuffer[]
  }
  export default UPNG
}
declare module 'pako' {
  const pako: object
  export default pako
}
