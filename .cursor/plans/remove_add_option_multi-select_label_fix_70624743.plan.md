---
name: Remove add option multi-select label fix
overview: Remove the broken "Create new bounding box" option; add multi-select for boxes (Shift+click) with bulk delete and hide rename when multiple selected; fix COCO/Pascal VOC parsing so labels with spaces (e.g. "Second Box") are preserved.
todos: []
isProject: false
---

# Remove add option, multi-select, and label-with-spaces fix

## 1. Remove the "Create new bounding box" option

**Rationale:** The plus-icon command fails and adding is already the default when drawing on the canvas, so removing the add option simplifies the UI.

**Changes:**

- **[package.json](package.json)**
  - Remove the `bounding-box-editor.createNewBbox` command from `contributes.commands`.
  - Remove from `view/title`: the createNewBbox entry for `boundingBoxEditor.bboxSectionView`.
  - Remove from `view/item/context`: both createNewBbox entries for `boundingBoxEditor.projectView` (imageWithBbox and imageOnly).
- **[src/bboxSection.ts](src/bboxSection.ts)**
  - Remove the `CreateNewBoxItem` class and the `CREATE_NEW_BBOX_COMMAND` export.
  - In `getChildren`: when there is a selected image but no bbox file, return a single placeholder item (e.g. "Open the image and draw on the canvas to add boxes") instead of CreateNewBoxItem; when the bbox file exists, return only box items (no CreateNewBoxItem at the top).
  - Update the `BboxSectionTreeItem` type to drop `CreateNewBoxItem`.
- **[src/extension.ts](src/extension.ts)**
  - Remove the `CREATE_NEW_BBOX_COMMAND` import and the entire `registerCommand(CREATE_NEW_BBOX_COMMAND, ...)` handler.
  - Remove `ADD_BOX_ON_OPEN_PREFIX` import if it is only used by that command; otherwise leave it (editorProvider may still reference it for "add box on open" if reintroduced later).
- **Tests**
  - [src/test/bboxSection.test.ts](src/test/bboxSection.test.ts): Remove or rewrite tests that assert CreateNewBoxItem (e.g. "CreateNewBoxItem has createNewBbox command and add icon"). Adjust getChildren tests: no selected image → placeholder; selected image + no bbox file → single "no boxes" placeholder; selected image + bbox file → only box items (no CreateNewBoxItem).
- **Docs**
  - [README.md](README.md): Update the sidebar/Bounding Boxes section description to say adding is done by drawing on the canvas; remove or rephrase the "Create new bounding box" sentence.

---

## 2. Multi-select boxes (Shift+click) and "Delete selected bounding boxes"

**Scope:** Support selecting multiple boxes in both the Bounding Boxes tree (VS Code tree multi-selection) and the editor webview (Shift+click). When multiple are selected: hide Rename, show a single "Delete selected bounding boxes" action; when one is selected, keep Rename and Remove/Delete as today.

**Data and API changes:**

- **[src/selectedImage.ts](src/selectedImage.ts)**
  - Replace single `selectedBoxIndex` with `selectedBoxIndices: number[]`.
  - Expose `getSelectedBoxIndices(): number[]` and `setSelectedBoxIndices(indices: number[])`.
  - Optionally keep `getSelectedBoxIndex()` / `setSelectedBoxIndex()` as helpers (e.g. single index when `indices.length === 1`) for minimal-impact migration where a single index is still used.
- **[src/editorProvider.ts](src/editorProvider.ts)**
  - **Webview script:** Change from `selectedBoxIndex` (number | null) to `selectedBoxIndices` (array of numbers).
    - **Click:** If Shift is held, toggle the hit box index in `selectedBoxIndices` (add if not present, remove if present); otherwise set `selectedBoxIndices = [hitIndex]`.
    - **Draw:** Apply `selected` class to every box whose index is in `selectedBoxIndices`.
    - **Resize handles:** Show only when `selectedBoxIndices.length === 1` (single selection); use that one index for handle logic.
    - **Keydown Delete/Backspace:** Remove all boxes at indices in `selectedBoxIndices` (sort indices descending, splice from `boxes`, then save and notify). Optionally support a single message `removeBoxAtIndices: number[]` for bulk delete.
    - **Messages:** Post `selectionChanged` with `selectedBoxIndices: number[]`; handle `removeBoxAtIndices` (array) in addition to existing `removeBoxAt` (single index) if introduced.
  - **Extension side:** In the message handler for `selectionChanged`, read `selectedBoxIndices` (array) and call `onSelectionChanged(document.uri, indices)`.
  - **getWebviewHtml / initial state:** Pass and embed `selectedBoxIndices` (array) instead of a single `selectedBoxIndex`.
- **[src/extension.ts](src/extension.ts)**
  - **Selection state:** Use `setSelectedBoxIndices(indices)` and `getSelectedBoxIndices()`; keep `editorSelectionByUri` as `Map<string, number[]>` (or equivalent) for editor-focused image.
  - **Context keys:**
    - `boundingBoxEditor.bboxSectionBoxSelected`: true when Bounding Boxes tree has at least one box selected (e.g. `bboxSectionTreeView.selection` contains at least one `BoxTreeItem`).
    - `boundingBoxEditor.bboxSectionMultipleBoxesSelected`: true when more than one box is selected in that tree.
  - **Tree selection listener:** On `bboxSectionTreeView.onDidChangeSelection`, set both context keys from `bboxSectionTreeView.selection` (filter to `BoxTreeItem`, same imageUri if needed).
  - **Rename:** Show Rename only when exactly one box is selected: e.g. `when` = `boundingBoxEditor.bboxSectionBoxSelected && !boundingBoxEditor.bboxSectionMultipleBoxesSelected` for the Bounding Boxes view; command palette Rename can use the same idea (single index from editor/tree).
  - **Delete/Remove:** One command that removes all currently selected boxes (from Bounding Boxes tree or from editor selection when invoked from command palette):
    - `getBoxTreeItemsFromSelection()`: return `bboxSectionTreeView.selection` filtered to `BoxTreeItem` (and same imageUri), or from project tree if needed; if invoked from palette with editor focused, use `editorSelectionByUri.get(imageUri)` (array of indices).
    - Sort indices descending, read bbox file, splice boxes, write file, refresh trees, and post to webview: either multiple `removeBoxAt` or one `removeBoxAtIndices` (if added).
  - **Reveal in Project tree:** When selection changes from editor, `revealBoxInProjectTree` can reveal the first selected box (or keep current behavior for single selection only).
- **[package.json](package.json)**
  - Menus: Rename in Bounding Boxes view title: add `&& !boundingBoxEditor.bboxSectionMultipleBoxesSelected` to the existing `when` so Rename is hidden when multiple boxes are selected.
  - Keep one "Remove box" / "Delete selected" style command that works for both single and multiple selection (no separate command needed; same handler for 1 or N).

**Bounding Boxes section display:** When multiple boxes are selected in the tree, show "(selected)" or similar only for items in the selection; the provider can use `getSelectedBoxIndices()` (or tree selection) to know which indices to mark. If selection is driven by the tree, selection is the source of truth; if by the editor, `selectedBoxIndices` is. Sync: when the user selects in the tree, set `setSelectedBoxIndices` from the tree selection and refresh; when the user selects in the editor, extension already gets `selectionChanged` and can refresh the Bounding Boxes list so "(selected)" reflects editor selection (tree view does not support setting selection programmatically).

---

## 3. Bounding box names with spaces (e.g. "Second Box")

**Cause:** In COCO and Pascal VOC parsing, the label is taken as a single token (`parts[4]`), so a line like `10 20 30 40 Second Box` is parsed with label `"Second"` only.

**Fix:**

- **[src/bbox.ts](src/bbox.ts)**
  - **parseCoco:** For the optional label, use everything after the first four numeric tokens: `label: parts.length > 4 ? parts.slice(4).join(' ') : undefined`.
  - **parsePascalVoc:** Same: `label: parts.length > 4 ? parts.slice(4).join(' ') : undefined`.
  - **YOLO:** Leave as-is (class is typically a single token; format is usually `class_id x y w h`).

Serialization (e.g. `serializeCoco`, `serializePascalVoc`) already outputs the full label string, so no change there. Add or extend a unit test in [src/test/bbox.test.ts](src/test/bbox.test.ts) that parses a COCO line with a label containing spaces and asserts the full label is preserved, and similarly for Pascal VOC if applicable.

---

## Implementation order

1. **Label fix (3)** — Small, isolated change in [src/bbox.ts](src/bbox.ts) and tests.
2. **Remove add option (1)** — Removes command, menus, CreateNewBoxItem, and updates bboxSection + tests + README.
3. **Multi-select (2)** — selectedImage API, then editorProvider webview and extension selection/context/delete/rename visibility.

---

## Summary


| Item                         | Action                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Add button / Create new bbox | Remove command, all menus, CreateNewBoxItem; bboxSection shows placeholder when no boxes and only box list when file exists.                |
| Multi-select                 | selectedBoxIndices in state and webview; Shift+click toggles selection; Delete removes all selected; Rename only when exactly one selected. |
| Label spaces                 | COCO and Pascal VOC: label = `parts.slice(4).join(' ')` (parse only).                                                                       |


