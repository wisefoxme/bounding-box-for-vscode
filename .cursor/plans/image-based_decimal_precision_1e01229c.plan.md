---
name: Image-based decimal precision
overview: Add a decimal-places rule derived from the source image size (digit count of max(width, height), capped at 8) and use it when serializing all floating-point coordinates in bbox files.
todos: []
isProject: false
---

# Image-based decimal precision for box file output

## Current behavior

- In [src/bbox.ts](src/bbox.ts), `serializeCoco`, `serializeYolo`, and `serializePascalVoc` output raw JavaScript numbers (no `toFixed`), so precision is whatever the runtime gives. Tesseract in [src/formatProviders/tesseractBox.ts](src/formatProviders/tesseractBox.ts) does the same.
- Serializers already receive `imgWidth` and `imgHeight` at the editor/extension level ([editorProvider.ts](src/editorProvider.ts) passes `document.imgWidth` / `document.imgHeight`). COCO and Pascal VOC low-level functions currently ignore dimensions; YOLO uses them only for normalization.

## Desired rule

- **Decimal places** = number of digits in `max(imageWidth, imageHeight)`, **capped at 8**.
- Examples: 1920×1080 → max 1920 → 4 digits → 4 decimal places; 100×50 → 3 decimal places; 1×1 → 1 decimal place.
- When dimensions are missing or zero (e.g. save before image load, or extension.ts paths that pass 0,0), use a **fallback** (e.g. 2 decimal places) so output is still deterministic.

## Implementation

### 1. Helper and formatting in [src/bbox.ts](src/bbox.ts)

- Add `**decimalPlacesForImage(imgWidth: number, imgHeight: number): number**`:
  - `maxDim = Math.max(0, imgWidth, imgHeight)`.
  - If `maxDim === 0`: return fallback (e.g. `2`).
  - Else: `digits = String(Math.floor(maxDim)).length`, then `return Math.min(8, digits)`.
- Add a small formatter used by all serializers, e.g. `**formatCoord(value: number, decimals: number): string**` → `Number.isInteger(value) ? String(value) : value.toFixed(decimals)` (or always `toFixed(decimals)` for consistency; then round-trip is still fine).

### 2. Use decimals in each serializer in [src/bbox.ts](src/bbox.ts)

- `**serializeCoco(boxes, imgWidth?, imgHeight?)**`
  - Add optional `imgWidth`, `imgHeight` (default 0).
  - `decimals = decimalPlacesForImage(imgWidth ?? 0, imgHeight ?? 0)`.
  - Format `x_min`, `y_min`, `width`, `height` with `formatCoord(..., decimals)`.
- `**serializeYolo(boxes, imgWidth, imgHeight)**`
  - Already has dimensions. Compute `decimals` the same way (with fallback when 0).
  - Format normalized values `x_center`, `y_center`, `w`, `h` with `formatCoord(..., decimals)`.
- `**serializePascalVoc(boxes, imgWidth?, imgHeight?)**`
  - Add optional dimensions; compute `decimals`; format `x_min`, `y_min`, `x_max`, `y_max` with `formatCoord(..., decimals)`.
- `**serializeBbox(..., imgWidth, imgHeight)**`
  - Pass `imgWidth`, `imgHeight` into `serializeCoco` and `serializePascalVoc` (already passes them for YOLO).

### 3. Format providers

- [src/formatProviders/coco.ts](src/formatProviders/coco.ts): in `serialize(boxes, imgWidth?, imgHeight?)`, call `serializeCoco(boxes, imgWidth, imgHeight)` so dimensions are passed when available.
- [src/formatProviders/pascalVoc.ts](src/formatProviders/pascalVoc.ts): same — `serializePascalVoc(boxes, imgWidth, imgHeight)`.
- [src/formatProviders/tesseractBox.ts](src/formatProviders/tesseractBox.ts): in `serialize`, compute `decimals = decimalPlacesForImage(_imgWidth ?? 0, _imgHeight ?? 0)` and format the four coordinates with that many decimals (import helper from bbox or duplicate the one-liner; prefer importing from bbox if we export there).

### 4. Tests

- **bbox.test.ts**
  - Test `decimalPlacesForImage`: e.g. (1920,1080)→4, (100,50)→3, (1,1)→1, (0,0)→fallback 2, (999999999,1)→8 (cap).
  - In existing round-trip tests, optionally assert that serialized lines use the expected number of decimal places when dimensions are set (e.g. 100×100 → 3 decimals in COCO/YOLO/Pascal VOC lines). Ensure round-trip still parses and matches.
- **formatProviders.test.ts**
  - Round-trips already pass dimensions for YOLO; for COCO/Pascal VOC, pass dimensions (e.g. 100,100) in serialize so new behavior is covered; verify output still parses and content is equivalent (allowing for rounding).

### 5. Edge cases

- **YOLO with dimensions 0**: Already returns `''`; no change. When dimensions are non-zero, apply the same decimal rule for the normalized values.
- **Extension paths that call `provider.serialize(boxes, 0, 0)**` ([extension.ts](src/extension.ts)): Will get fallback decimals (2); no need to change call sites unless we want to plumb dimensions there later.

## Summary


| File                                                                       | Change                                                                                                                                                    |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/bbox.ts](src/bbox.ts)                                                 | Add `decimalPlacesForImage`, `formatCoord`; extend COCO/Pascal VOC signatures and use decimals; use decimals in YOLO; pass dimensions in `serializeBbox`. |
| [src/formatProviders/coco.ts](src/formatProviders/coco.ts)                 | Pass `imgWidth`, `imgHeight` into `serializeCoco`.                                                                                                        |
| [src/formatProviders/pascalVoc.ts](src/formatProviders/pascalVoc.ts)       | Pass `imgWidth`, `imgHeight` into `serializePascalVoc`.                                                                                                   |
| [src/formatProviders/tesseractBox.ts](src/formatProviders/tesseractBox.ts) | Compute decimals from optional dimensions; format coordinates (import helper from bbox).                                                                  |
| [src/test/bbox.test.ts](src/test/bbox.test.ts)                             | Tests for `decimalPlacesForImage` and decimal places in serialized output.                                                                                |
| [src/test/formatProviders.test.ts](src/test/formatProviders.test.ts)       | Pass dimensions in COCO/Pascal VOC serialize where needed; verify round-trip.                                                                             |


No changelog entry was requested; add one under `[Unreleased]` / `### Changed` only if you want to document this behavior for users.