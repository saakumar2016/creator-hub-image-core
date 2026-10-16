# @creator-hub/image-core

Image code shared by the [Creator Hub](https://github.com/saakumar2016) tools (Image Cropper,
Image Resizer, and the coming Image Compressor): limits and validation, decode and encode in the
browser, file names, a small ZIP writer, downloads and sharing, and the Cloudflare Pages build
helpers of the tool remotes.

- Plain TypeScript and browser APIs only: no React, no UI, no translated strings, no tool logic.
- Images are processed **only in the browser**; nothing is uploaded.
- ESM, compiled to `dist/` (`.js` + `.d.ts`). Node ≥ 22.12 for the build helpers.

## Install

The tools install it at build time from a version tag (not from npm, not shared through Module
Federation; each tool's bundler bundles what it imports):

```bash
npm install git+https://github.com/saakumar2016/creator-hub-image-core.git#v0.1.0
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
| `@creator-hub/image-core/downloads` | `saveBlob`, `saveEach` (one after another, 300 ms apart), `canShareFiles` (`navigator.canShare({ files })`), `shareFiles` (user cancel → `'cancelled'`) |
| `@creator-hub/image-core/pages` (Node) | `checkAllowedOrigin`, `renderHeaders`, `devPageFiles`, `runPostbuild` |
| `@creator-hub/image-core` | everything above except `pages` |

CLI for a tool's `build:pages` (after `vite build`, in the tool's folder):

```json
"build:pages": "npm run build && image-core-pages-postbuild"
```

It writes `dist/_headers` with `Access-Control-Allow-Origin` for the shell origin in
`REMOTE_ALLOWED_ORIGIN` (https, origin only, never local or a wildcard — the build fails
otherwise), and removes the standalone dev page and the chunks only it uses.

## Development

```bash
npm ci            # also builds (prepare)
npm test          # Vitest (jsdom); includes a check of the ZIP output with Python zipfile and unzip -t
npm run lint
npm run typecheck
npm run build
```

Versions are released as tags (`v0.1.0`, …); tools update the tag in their `package.json`.

Used by Creator Hub tools. MIT license.
