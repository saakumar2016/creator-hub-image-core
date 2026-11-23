# Changelog

## 0.4.0

- New optional entry point `@creator-hub/image-core/background`: `removeBackground(image, { modelUrl, ortBase?, modelBytes?, signal?, onProgress? })` and `composeBackground(cutout, background)`.
  - `removeBackground` returns the photo at its own size as RGBA with the background transparent (U²-Net small "u2netp", ONNX; the model is given by URL and is not part of this package). The mask is resized smoothly to the photo's size and the edge gets a light feather.
  - The model and the onnxruntime-web files are fetched only when `removeBackground` is called, and the model only once per page (the session is kept). It runs in a Web Worker; where workers cannot be used, on the main thread.
  - `onProgress` reports `{ stage: 'download', loaded, total }` on the first call and then `{ stage: 'processing' }`. `signal` cancels (`AbortError`). A wrong model URL gives a `BackgroundModelError` with the URL and the status.
  - `composeBackground(cutout, 'transparent' | '#rrggbb')` returns a new canvas.
  - `onnxruntime-web` 1.30.0 is an optional peer dependency (exact version); the main entry and the other entries import none of this.
- Nothing else changes.

## 0.3.1

- `announceDownload` and the `imginsta:download` event on `saveBlob`, `saveEach` and `shareFiles`.

Earlier versions are tags in the repository (`v0.1.0`, `v0.2.1`, `v0.3.0`).
