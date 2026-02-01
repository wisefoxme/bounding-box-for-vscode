---
name: Format providers and auto-detect
overview: Introduce a format-providers layer (Coco, Yolo, Pascal VOC, Tesseract .box) with auto-detection, session-scoped provider selection per image (in memory), and use it everywhere we parse/serialize so the explorer and editor show boxes (and labels) correctly for each format, including Tesseract where the label is the first token per line and can be multi-character.
todos: []
isProject: false
---

# Format providers and auto-detection

## Goals

1. **Format provider folder**: One place that defines how each standard format is parsed and serialized (COCO, YOLO, Pascal VOC, Tesseract .box).
2. **Auto-detect**: Infer which format a file adheres to and use the matching provider for that image for the current session (in memory only).
3. **Explorer display**: Show bounding boxes (and labels) according to the detected format. For Tesseract .box, the label is taken from the first token(s) on each line (multi-character allowed).

## Current state

- Format is chosen only by setting `boundingBoxEditor.bboxFormat` (coco | yolo | pascal_voc).
- Parsing/serializing live in [src/bbox.ts](src/bbox.ts) (`parseBbox`, `serializeBbox` + per-format helpers).
- [readMergedBboxContent](src/settings.ts) in [src/settings.ts](src/settings.ts) uses `getSettings().bboxFormat` and `parseBbox(content, format, 0, 0)`.
- Editor, explorer, bboxSection, and [extension.ts](src/extension.ts) commands all use `settings.bboxFormat` for parse/serialize.

## Design

### 1. Format provider interface and folder

- **New folder**: `src/formatProviders/` (or `src/bboxFormats/`).
- **Interface** (e.g. in `types.ts` or `provider.ts`):
  - `id: string` (e.g. `'coco'`, `'yolo'`, `'pascal_voc'`, `'tesseract_box'`).
  - `parse(content: string, imgWidth?: number, imgHeight?: number): Bbox[]`.
  - `serialize(boxes: Bbox[], imgWidth?: number, imgHeight?: number): string`.
  - `detect(content: string): boolean` (or a score) — heuristics to see if this format fits the content.
- **Implementations**: Move or wrap existing logic into provider classes/modules:
  - **CocoProvider**: COCO lines = 4+ numbers (x_min y_min width height [label]). Detect: lines match `^\d+\s+\d+\s+\d+\s+\d+` (optional rest).
  - **YoloProvider**: class + 4 normalized floats. Detect: lines have 5 tokens, tokens 1–4 are floats in [0,1].
  - **PascalVocProvider**: x_min y_min x_max y_max [label]. Detect: 4 numbers, 3rd > 1st, 4th > 2nd.
  - **TesseractBoxProvider**: Tesseract .box style — **label x_min y_min x_max y_max [page]** per line. Label = everything before the last 4 (or 5 if page) numeric tokens; not limited to one character. Parse: for each line, take last 4 numeric tokens as x_min, y_min, x_max, y_max; remainder = label. Convert to internal `Bbox` (width = x_max - x_min, height = y_max - y_min, label). Serialize: back to `label x_min y_min x_max y_max page` (page 0 if omitted). Detect: e.g. most lines have pattern “non-empty token(s) + 4 numbers (+ optional page)”.
- **Registry**: Single module that:
  - Registers all providers.
  - `detect(content: string): BboxFormatProvider | null` — try each provider’s `detect(content)`, return first match (or best score). If none, return `null` (caller uses settings default).
  - `getProvider(id: string): BboxFormatProvider | undefined` — get by id (for mapping `settings.bboxFormat` to provider).
  - **Session cache (in memory only)**: `getProviderForImage(imageUri: vscode.Uri): BboxFormatProvider | undefined` and `setProviderForImage(imageUri: vscode.Uri, provider: BboxFormatProvider): void`. Used so the same image uses the same provider until the session ends (no persistence).

### 2. Tesseract .box format (concrete)

- **Line format**: `label x_min y_min x_max y_max [page]`. Label may be one or more characters (no artificial single-char limit).
- **Parse**: Split line by whitespace; from the end, take the last 4 tokens that are numeric as x_min, y_min, x_max, y_max (and optionally 5th as page). Everything before that = label (trimmed, can be multi-char). Convert to `Bbox`: x_min, y_min, width = x_max - x_min, height = y_max - y_min, label.
- **Serialize**: For each box: `label x_min y_min x_max y_max 0` (or omit page / use 0).
- **Detect**: e.g. majority of non-empty lines match “at least one non-numeric token + exactly 4 numbers at end” (and optionally a 5th number).

### 3. Where format is decided and used

- **readMergedBboxContent** ([src/settings.ts](src/settings.ts)):
  - After reading candidate files, get a single “content to detect from”: e.g. content of the **first successfully read file** (primary file) to avoid mixing formats.
  - Call `registry.detect(content)`; if non-null, `setProviderForImage(imageUri, provider)`.
  - If null, use `getProvider(settings.bboxFormat)` (map coco/yolo/pascal_voc to existing providers).
  - Parse each file’s content with the chosen provider (same for all), merge boxes, return `{ content, boxes, primaryUri }` as today. No need to change the return type if callers only need boxes; they will use the same provider later via cache when serializing.
- **Editor** ([src/editorProvider.ts](src/editorProvider.ts)):
  - **openCustomDocument**: Uses `readMergedBboxContent` (which now detects and sets provider for this image). Optionally store the provider on the document (e.g. `document.formatProvider`) so save does not depend on cache. Prefer: store provider on document so each document has a single format for its lifetime.
  - **Save**: Use `document.formatProvider.serialize(...)` (or `getProviderForImage(document.uri)` if not stored on document). Write to `document.bboxUri` as today.
  - **YOLO re-parse on init**: Use document’s provider (or cached provider for document.uri) to re-parse when dimensions arrive.
- **Explorer** ([src/explorer.ts](src/explorer.ts)) and **Bbox section** ([src/bboxSection.ts](src/bboxSection.ts)):
  - They already get boxes from `readMergedBboxContent`; no change to display logic. Boxes already carry `label`; tree items already show label or “Box N”. Tesseract boxes will have labels from the first token(s) and will display correctly.
- **Extension commands** ([src/extension.ts](src/extension.ts)):
  - All places that read bbox file, parse, modify, and write (rename, delete, createNewBbox, etc.): use `getProviderForImage(imageUri) ?? getProvider(settings.bboxFormat)` for both parse and serialize. If no cached provider (e.g. user never opened that image in editor), use settings default.

### 4. Settings and backward compatibility

- **Keep** `boundingBoxEditor.bboxFormat` as the default/fallback when:
  - Detection returns no provider, or
  - No cached provider for that image (e.g. command used without having opened the image).
- **Do not** add `tesseract_box` to the setting enum unless you want it user-selectable; detection alone can enable Tesseract. If you later add it to the enum, the registry can map it to TesseractBoxProvider.

### 5. Files to add or touch


| Area                                                                         | Changes                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **New** `src/formatProviders/`                                               | `types.ts` (interface + Bbox re-export or import), `registry.ts` (registry + detection + session map), `coco.ts`, `yolo.ts`, `pascalVoc.ts`, `tesseractBox.ts`. Optionally `index.ts` to re-export.                    |
| [src/bbox.ts](src/bbox.ts)                                                   | Keep as-is or gradually have providers delegate to existing parse/serialize helpers. No breaking change: providers can call current `parseCoco`, `parseYolo`, etc.                                                     |
| [src/settings.ts](src/settings.ts)                                           | `readMergedBboxContent`: get first file’s content, call registry.detect, setProviderForImage, then parse all files with chosen provider and merge. Use registry instead of parseBbox + settings.bboxFormat.            |
| [src/editorProvider.ts](src/editorProvider.ts)                               | openCustomDocument: get provider from registry after readMergedBboxContent (or from result if we return it). Store provider on document. Save and YOLO re-parse use document’s provider.                               |
| [src/extension.ts](src/extension.ts)                                         | All command handlers that read/parse/write bbox: use getProviderForImage(uri) ?? getProvider(settings.bboxFormat) for parse and serialize.                                                                             |
| [src/explorer.ts](src/explorer.ts), [src/bboxSection.ts](src/bboxSection.ts) | No display logic change; they already show boxes and labels from readMergedBboxContent.                                                                                                                                |
| Tests                                                                        | Unit tests for each provider (parse/serialize/detect), especially Tesseract (multi-char label, page). Integration test that readMergedBboxContent + registry yields correct provider and boxes for a sample .box file. |


### 6. Detection order and fallback

- Run detection in a fixed order (e.g. Tesseract, then YOLO, then Pascal VOC, then COCO) so that the first match wins. Tesseract can be identified by “label + 4 numbers” pattern; YOLO by normalized floats; Pascal by x_max/y_max; COCO by 4 numbers (width/height). If two formats could match, order decides; document in code that Tesseract is checked first so typical .box files are recognized.

### 7. Session cache lifecycle

- Map key: `imageUri.toString()`.
- Populated when we first read/parse content for that image (in readMergedBboxContent or openCustomDocument).
- Cleared only when the extension deactivates (no persistence). Optional: clear cache when the bbox file is deleted or when the user explicitly “resets format” (could be a later command).

## Summary

- New **format providers** folder with Coco, Yolo, Pascal VOC, and **Tesseract .box** (label = first token(s), multi-char).
- **Registry** with `detect(content)`, session cache `get/setProviderForImage(uri)` (in memory only), and `getProvider(id)` for settings fallback.
- **readMergedBboxContent** detects format from the first read file, caches provider for that image, and parses with the chosen provider.
- **Editor** stores provider on document and uses it for save and re-parse; **commands** use cached or settings-based provider.
- **Explorer** and **Bbox section** keep showing boxes/labels from merged result; Tesseract labels (including multi-char) show as-is.

