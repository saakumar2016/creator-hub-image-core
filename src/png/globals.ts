// upng-js is a CommonJS file from 2017. Where it cannot call `require` (a worker bundled as an IIFE, Vite's default) it falls back to
// `window.pako`, and `window` does not exist in a worker. This file runs first (engine.ts imports it before upng-js) and gives it both.
import pako from 'pako'

const scope = globalThis as unknown as { window?: unknown; pako?: unknown }
scope.window ??= globalThis
scope.pako ??= pako

export const upngGlobalsReady = true
