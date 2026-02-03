---
name: Panel list update on new box
overview: Fix the Bounding Boxes panel not updating when a new bounding box is added by calling onBoxesChanged immediately when document.boxes is updated from a dirty message, and tighten tests so this behavior is asserted.
todos: []
isProject: false
---

# Panel list update when adding a new bounding box

## Root cause

The Bounding Boxes panel list is driven by [BboxSectionTreeDataProvider.getChildren](src/bboxSection.ts): it uses `getLiveBoxes(uri)` (which calls [editorProvider.getBoxesForImage(uri)](src/editorProvider.ts)) when the editor is open, so the list shows in-memory `document.boxes`.

When the user adds a box (draw or "add box"), the webview posts `dirty` with `boxes`. In [editorProvider.ts](src/editorProvider.ts) (lines 264–274), the handler does:

1. `document.boxes = msg.boxes` (sync)
2. `void this._writeBoxesToDiskAndNotify(document).then(() => { this._options.onBoxesChanged?.(...); this._options.onBboxSaved?.(...); })`

So **onBoxesChanged is only called after the disk write completes**. The panel refresh therefore happens only after the write. If the write is slow, fails (e.g. YOLO dimensions not ready), or there is any ordering quirk, the list can stay stale. The existing plan ([list_update_and_label_palette_e22a1b27.plan.md](.cursor/plans/list_update_and_label_palette_e22a1b27.plan.md)) intended "after updating document.boxes, call onBoxesChanged" but the code only calls it in the write’s `.then()`.

## Fix

**File: [src/editorProvider.ts**](src/editorProvider.ts) (dirty handler, ~264–274)

- When `msg.type === 'dirty'` and `Array.isArray(msg.boxes)`:
  1. Set `document.boxes = msg.boxes`.
  2. Call **onBoxesChanged immediately**: `this._options.onBoxesChanged?.(document.uri)` so the panel refreshes right away and `getChildren()` sees the new boxes via `getLiveBoxes` → `getBoxesForImage`.
  3. Keep the async write and call only **onBboxSaved** in the `.then()` (remove `onBoxesChanged` from the `.then()` to avoid double refresh).

Result: list updates as soon as the host has the new boxes, without waiting for the write.

## Tests

1. **E2E ([src/test/bboxEditor.e2e.test.ts](src/test/bboxEditor.e2e.test.ts))**
  The test currently uses conditional assertions for the panel list (e.g. "if (boxItems2.length >= 2) assert...") and a comment that "the Bounding Boxes tree may not show live boxes (URI/refresh timing)".
  - After adding the second box (addBox + renameBoxAt + optional save), **assert strictly** that `bboxSectionProvider.getChildren(undefined)` returns exactly two box items with the expected labels (e.g. "First Box", "Second Box"). If the E2E environment does not run the webview and the host never receives `dirty`, this may require a short delay and/or relying on the post-save refresh; the goal is to make the test fail if the panel list does not reflect the new box.
  - Similarly tighten the assertion after the first box (and any other add/delete step) so the panel list count and labels are required, not optional.
2. **Unit test for dirty → onBoxesChanged**
  Add a test that ensures when the editor provider receives a `dirty` message with `boxes`, it calls `onBoxesChanged` with the document URI. This can be done by:
  - Using the existing E2E-style setup (open document, resolve editor with a mock webview that stores the message handler), then emitting `{ type: 'dirty', boxes: [...] }` and asserting a spy on `onBoxesChanged` was called; or
  - Adding a small test hook (e.g. test-only path) that simulates receiving the message and asserting `onBoxesChanged` and updated `getBoxesForImage`; only if the E2E cannot reliably run the webview.

Prefer strengthening the E2E assertions first; add the unit test if needed to reach coverage or to avoid flakiness when the webview does not run in E2E.

## Changelog

Per [.cursor/rules/changelog.mdc](.cursor/rules/changelog.mdc): under `## [Unreleased]` → `### Fixed`, add: "Bounding Boxes panel list now updates immediately when adding a new bounding box (draw or add box), without waiting for save."

## Summary


| Item                                                               | Action                                                                                                                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/editorProvider.ts](src/editorProvider.ts)                     | In dirty handler: call `onBoxesChanged(document.uri)` right after `document.boxes = msg.boxes`; in `.then()` of `_writeBoxesToDiskAndNotify` call only `onBboxSaved`. |
| [src/test/bboxEditor.e2e.test.ts](src/test/bboxEditor.e2e.test.ts) | Require panel list to show correct count and labels after add/delete (strict assertions, no conditional "if length >= N").                                            |
| Unit test                                                          | Add test that dirty-with-boxes triggers onBoxesChanged (and optionally that getBoxesForImage returns new boxes).                                                      |
| [CHANGELOG.md](CHANGELOG.md)                                       | Add entry under Unreleased / Fixed.                                                                                                                                   |


