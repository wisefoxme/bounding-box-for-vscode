---
name: Draw new box on image
overview: Add click-and-drag on empty image space in the custom editor webview to create a new bounding box, with a live preview rectangle and optional minimum-size threshold.
todos: []
isProject: false
---

# Draw new bounding box on image (click-and-drag)

## Goal

When the user clicks on empty space (not on a box or handle) in the custom editor and drags, show a preview rectangle and on mouse release create a new bounding box, save, and select it. Small drags can be ignored to avoid accidental tiny boxes.

## Current behavior (relevant parts)

- [src/editorProvider.ts](src/editorProvider.ts): Webview has an SVG overlay over the image. `mousedown` on SVG: if handle hit → start resize/move (`drag`); if box/edge hit → select and start drag; **else** → clear selection only.
- Box format in JS: `{ x_min, y_min, width, height, label? }` in image pixels. `svgCoordsToImage(ev)` converts client coords to image coords.
- `draw()` renders boxes and selected handles; `vscode.postMessage({ type: 'save', boxes })` persists.

## Implementation (webview script only)

All changes are inside the inline script in `getWebviewHtml()` in [src/editorProvider.ts](src/editorProvider.ts).

### 1. Draw state

- Add a variable, e.g. `drawStart = null` (or `{ x, y }` in image coords when drawing).
- When `drawStart` is set, we are in "draw new box" mode; when `drag` is set, we are in "resize/move" mode. Only one can be active.

### 2. Mousedown (empty space)

- In the existing `svg.addEventListener('mousedown', ...)`, the branch that currently does "else { selectedBoxIndex = null; draw(); }" runs when neither handle nor box is hit.
- **Change**: instead of only clearing selection, set `drawStart = svgCoordsToImage(e)` (image coords), keep `selectedBoxIndex = null`, and call `draw()`. Do **not** set `drag`, so the existing mousemove/mouseup resize logic is skipped.

### 3. Preview rectangle

- In `draw()`: if `drawStart` is set, we need a current pointer position in image coords. Add a second variable, e.g. `drawCurrent`, updated in mousemove (see below).
- In `draw()`, after drawing boxes and handles, if `drawStart` and `drawCurrent` exist, compute normalized rect in image coords:
`x_min = Math.max(0, Math.min(drawStart.x, drawCurrent.x))`,
`x_max = Math.min(imgWidth, Math.max(drawStart.x, drawCurrent.x))`,
same for y; then `width = x_max - x_min`, `height = y_max - y_min`. Convert to display coords (scaleX/scaleY) and append one more rect with a distinct class, e.g. `bbox-preview` (stroke only, no handles).
- Add CSS for `.bbox-preview` (e.g. dashed stroke, different color) so it’s clearly temporary.

### 4. Mousemove

- In the existing `window.addEventListener('mousemove', ...)`: before or after the `if (!drag) return;` block, add a branch: if `drawStart !== null`, get image coords with `svgCoordsToImage(e)`, set `drawCurrent` to that (optionally clamp to image bounds 0..imgWidth, 0..imgHeight), then call `draw()` and `return` (so resize logic does not run). This gives a live preview while dragging.

### 5. Mouseup

- In the existing `window.addEventListener('mouseup', ...)`: after handling `drag` (clear drag and save), add: if `drawStart !== null`, compute the same normalized rect (x_min, y_min, width, height) in image coords from `drawStart` and current position (use `drawCurrent` stored from last mousemove, or derive from a single mouseup — storing from mousemove is more accurate).
- **Minimum size**: if `width < MIN_PIXELS` or `height < MIN_PIXELS` (e.g. 5), discard: clear `drawStart` and `drawCurrent`, redraw, no new box and no save.
- Otherwise: push `{ x_min, y_min, width, height }` (with optional `label` if the format supports it) to `boxes`, set `selectedBoxIndex = boxes.length - 1`, clear `drawStart` and `drawCurrent`, call `draw()`, then `vscode.postMessage({ type: 'save', boxes })`.
- Ensure mouseup always clears `drawStart`/`drawCurrent` so we don’t get stuck in draw mode (e.g. if mouseup happens without mousemove, use drawStart for both corners so width/height are 0 and we discard).

### 6. Edge cases

- **Image not loaded**: if `imgWidth`/`imgHeight` are 0, do not set `drawStart` on mousedown (or no-op in mousemove/mouseup).
- **Clamping**: Normalize rect from drawStart/drawCurrent and clamp to `[0, imgWidth]` x `[0, imgHeight]` so the new box never goes outside the image.
- **Cursor**: Optionally set cursor to crosshair when `drawStart` is set (e.g. on SVG or body) for feedback.

## Files to touch

- [src/editorProvider.ts](src/editorProvider.ts): CSS for `.bbox-preview`; script: `drawStart`, `drawCurrent`, mousedown branch for empty space, `draw()` preview rect, mousemove draw branch, mouseup create-box + min size + clear.

## Tests

- [src/test/editorProvider.test.ts](src/test/editorProvider.test.ts): Add a test that the generated HTML contains a string indicating draw behavior, e.g. `bbox-preview` or `drawStart` (so we don’t regress the feature). No change to `getWebviewHtml` signature; existing tests remain valid.
- Run `npm test` and keep coverage above 80%.

## Optional (out of scope for minimal plan)

- Crosshair cursor during draw.
- Escape key to cancel drawing (clear `drawStart`/`drawCurrent` and redraw).

