# @creator-hub/image-core

Image code shared by the [Creator Hub](https://github.com/saakumar2016) tools (Image Cropper,
Image Resizer, and the coming Image Compressor): limits and validation, decode and encode in the
browser, file names, a small ZIP writer, a small PDF writer, downloads and sharing, and the Cloudflare Pages build
helpers of the tool remotes.

- Plain TypeScript and browser APIs only: no React, no UI, no translated strings, no tool logic.
- Images are processed **only in the browser**; nothing is uploaded.
- ESM, compiled to `dist/` (`.js` + `.d.ts`). Node ≥ 22.12 for the build helpers.

## Install

The tools install it at build time from a version tag (not from npm, not shared through Module
Federation; each tool's bundler bundles what it imports):

```bash
npm install git+https://github.com/saakumar2016/creator-hub-image-core.git#v0.3.0
```

Use the `git+https://` form (not `github:`): npm then records an `https` URL in the lockfile, so
`npm ci` works on CI and Cloudflare Pages without an SSH key or token (the repo is public).

npm clones the tag, installs the package's dependencies and devDependencies, runs `prepare`
(`tsc` build) and installs the built package. The tool's lockfile pins the commit.

## API

| Import | Contents |
|---|---|
| `@creator-hub/image-core/limits` | `MAX_FILE_BYTES` (25 MB), `MAX_DIMENSION` (10,000 px per side), `MAX_PIXELS` (50 MP), `IMAGE_TYPES`, `ImageType`, `OutputChoice`, `FORMAT_LABEL`, `EXTENSION`, `LOSSY_QUALITY`, `isImageType`, `checkFile`, `checkImageSize`, `withinArea`, `outputType`, `formatBytes` |
| `@creator-hub/image-core/names` | `outputFileName` (`name-WxH.ext`), `splitFileName` (`name-k.ext`), `typedPrefix`, `sanitizePrefix`, `defaultPrefix`, `outputName` (`prefix-k.ext`), `zipName` |
| `@creator-hub/image-core/codec` | `decodeImage` (EXIF orientation applied), `encodeCanvas` (JPG/WebP quality, falls back → `UnsupportedOutputError`), `canEncode`, `fillWhite` (JPG has no transparency), `createCanvas`, `ImageDecodeError`, `EncodeError` |
| `@creator-hub/image-core/zip` | `zipStore` (stored entries, CRC-32, UTF-8 names), `crc32`, `zipSize`, `MAX_ZIP_BYTES`, `ZipTooLargeError` |
| `@creator-hub/image-core/pdf` (new in v0.2.1) | `writePdf` (Blob), `pdfStore` (parts), `parseJpegSize`, `mmToPt`, `pxToPt`, `estimatePdfOverhead`, `PdfError`, `MAX_PAGE_PT`, `PDF_MIME` |
| `@creator-hub/image-core/downloads` | `saveBlob`, `saveEach` (one after another, 300 ms apart), `canShareFiles` (`navigator.canShare({ files })`), `shareFiles` (user cancel → `'cancelled'`), `DOWNLOAD_EVENT`, `announceDownload` (new in v0.3.1) |
| `@creator-hub/image-core/png` (new in v0.3.0; optional, a separate entry; see "PNG compress") | `compressPng`, `PNG_MAX_PIXELS`, `PngTooLargeError`, `PngCompressError`, types |
| `@creator-hub/image-core/pages` (Node) | `checkAllowedOrigin`, `renderHeaders`, `devPageFiles`, `runPostbuild` |
| `@creator-hub/image-core` | everything above except `pages` and `png` (the main entry never imports upng-js, pako or oxipng) |

### Download event (new in v0.3.1)

`saveBlob` (so `saveEach` too, once per file) and `shareFiles` (only on `'shared'`, not on cancel or error) dispatch a plain `CustomEvent('imginsta:download')` on `window`, with no detail and no data; printing is not a download and sends nothing. A tool that downloads with a plain `<a download>` calls `announceDownload()` from its `onClick` (without `preventDefault`).
The shell listens for the event (to show its bookmark tip); tools never import shell code, they only send this event. With no listener, or without a `window` (SSR, Node), nothing happens.

### PDF writer

One JPEG per page, drawn on the whole page, embedded **unchanged** (no decoding, no re-encoding).
Plain PDF 1.4 with a classic cross-reference table; no metadata, dates or producer string.
Supported JPEGs: baseline (SOF0) Huffman, 8 bits, 1 component (gray) or 3 components (colour).
Extended sequential, progressive, arithmetic, lossless, 12-bit and 4-component (CMYK) files, and
files with a damaged frame header, throw a `PdfError` that says so. A page is at most 14,400 pt (200 in) per side.

```ts
import { mmToPt, parseJpegSize, writePdf } from '@creator-hub/image-core/pdf'

const jpeg = new Uint8Array(await sheetBlob.arrayBuffer()) // a JPEG file
const { width, height } = parseJpegSize(jpeg)
const pdf = writePdf([
  { jpeg, widthPx: width, heightPx: height, pageWidthPt: mmToPt(101.6), pageHeightPt: mmToPt(152.4) },
]) // Blob, type "application/pdf"
```

`widthPx` / `heightPx` must match the JPEG (checked). The PDF adds about 700 bytes per page to the
JPEG data; `estimatePdfOverhead(pageCount)` returns an upper bound for a size limit.

CLI for a tool's `build:pages` (after `vite build`, in the tool's folder):

```json
"build:pages": "npm run build && image-core-pages-postbuild"
```

It writes `dist/_headers` with `Access-Control-Allow-Origin` for the shell origin in
`REMOTE_ALLOWED_ORIGIN` (https, origin only, never local or a wildcard — the build fails
otherwise), and removes the standalone dev page and the chunks only it uses.

### PNG compress

Lossy PNG compression where the file stays a **PNG**: fewer colours (256, then 128, then 64), then a lossless oxipng pass, in a Worker.
It is a separate entry, so a tool that does not use it ships **none** of it (measured: the same build output, byte for byte, before and
after). Load it when it is called:

```ts
const { compressPng, PngTooLargeError } = await import('@creator-hub/image-core/png')
const result = await compressPng(imageData, { targetBytes: 500 * 1024, signal })
// result: { blob (image/png), bytes, colors (256, 128 or 64; or the image's own count when it has 256 or fewer), reachedTarget }
```

| Option | Default | |
|---|---|---|
| `targetBytes` | none | The size to stay under. The **highest** colour count whose final size is at most this wins. Without it: one pass at 256 colours. |
| `minColors` | 64 | The lowest rung: 64, 128 or 256 (below 64 the spike showed visible banding on photos). |
| `level` | 2 | oxipng level 1 or 2. Level 3 saves a few percent more and takes 4-6 s per 1.5 MP. |
| `signal` | | Aborting terminates the worker and rejects with an `AbortError`. |
| `onProgress` | | `{ stage: 'quantize' \| 'optimize', colors }`. |

- Input is RGBA `ImageData` (or `{ data, width, height }`); resizing stays the tool's job. The pixels are copied to the worker (the caller's `ImageData` is not detached).
- If even the lowest rung is over `targetBytes`, you get that rung with `reachedTarget: false` (the tool can offer WebP).
- An image with 256 colours or fewer is tried **exactly** first (its own palette, lossless). Alpha: fully transparent pixels stay 0 and fully opaque pixels stay 255 (they are quantized apart from the partly transparent ones; plain UPNG lowered the alpha of 0.7-2.2 % of the opaque pixels of real logos).
- `PNG_MAX_PIXELS = 12_000_000`: more throws `PngTooLargeError`. Measured in Chrome (worker, 4 cores, Vite 8): 12 MP took 15.7 s without a target and 22 s when the ladder ran down to 64 colours; 1.5 MP took 2-4 s; memory grew by 270-650 MB at 12 MP. A phone will be slower, so tools should cap the longest side (the Compressor already does) before calling it.
- Errors are typed: `PngTooLargeError`, `PngCompressError` (worker or wasm failed; the message says why, for example a wasm file served with the wrong MIME type), `AbortError`. Invalid options throw `RangeError`.
- The heuristic that saves time: oxipng is not run on a rung whose raw size times 0.8 (0.5 for a truecolour image that is turned into a palette) is still over the target; the last rung always runs.
- Uses Vite (`?worker&inline`, `?url`), like the tools do. In a test (Vitest) mock `@creator-hub/image-core/png`.

**Consumer config.** `vite build` needs nothing. `vite` (dev) pre-bundles dependencies, which cannot resolve the worker import, so a tool that uses `/png` needs this in `vite.config`:

```ts
optimizeDeps: {
  exclude: ['@creator-hub/image-core'],
  include: ['@creator-hub/image-core > upng-js', '@creator-hub/image-core > pako'],
},
```

(Both `include` lines are needed: with only one of them the worker fails in dev. No `worker.format` setting is needed; the default `iife` and `es` both work.)

**Module Federation remotes.** The worker is bundled into the remote's chunk and starts from a `blob:` URL of the page (a `new Worker(<other origin>)` is refused by the browser). The oxipng wasm (164 kB, 77 kB gzip) is a separate file under `assets/`; the worker fetches it from an absolute URL made from the remote's own URL, so the host's page origin needs the remote's usual CORS header (the generated `_headers` already puts it on `/assets/*`) and the file must be served as `application/wasm` (Cloudflare Pages does). Checked in Chrome with a host and a remote on two origins; with a missing or wrong `Access-Control-Allow-Origin` the remote fails to load, with another MIME type `compressPng` rejects with `PngCompressError`.

`upng-js` is pinned to an exact version (2.1.0, no `^` or `~`): the alpha handling calls `UPNG.quantize`, which its README does not document, so an update must be a deliberate step with the tests re-run (`pako` and `@jsquash/oxipng` are pinned too).

Third-party code in this entry (upng-js, pako, @jsquash/oxipng, oxipng): `THIRD_PARTY_NOTICES.md`.

## Development

```bash
npm ci            # also builds (prepare)
npm test          # Vitest (jsdom); includes checks of the ZIP output (Python zipfile, unzip -t) and of the PDF output (pdfinfo, pdfimages, Ghostscript, qpdf, mutool: each one that is installed)
npm run lint
npm run typecheck
npm run build
```

Versions are released as tags (`v0.1.0`, `v0.2.1`, `v0.3.0`, …); tools update the tag in their `package.json`.
`v0.2.0` points at the same commit as `v0.1.0` and has no PDF writer: use `v0.2.1` or later.

Used by Creator Hub tools. MIT license.
