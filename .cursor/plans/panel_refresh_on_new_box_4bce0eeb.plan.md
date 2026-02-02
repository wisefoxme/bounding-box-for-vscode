# Panel refresh when a new bounding box is created (scoped to current image)

## Problem

The file is updated when a new bounding box is created, but the side panel does not update until the user clicks the refresh icon. The refresh should run automatically when a new box is created, and it should apply only to the **tree of the current image** — not the entire folder.

## Approach

1. **Refresh icon** (user-triggered): Keeps full `refreshTrees()` — refresh entire project tree + bbox section.
2. **onBoxesChanged / onBboxSaved**: Refresh only the **current image’s branch** in the project tree + bbox section, so we don’t refresh the whole folder every time.

## Implementation

### 1. Project tree: scoped refresh by image

**[src/explorer.ts](src/explorer.ts)** — `ProjectTreeDataProvider`:

- **Cache** `ProjectTreeItem` by image URI when building the root list: in `getChildren(undefined)`, after building the `items` array, set a private `Map<string, ProjectTreeItem>` (e.g. `_projectItemByUri`) from `imageUri.toString()` to each `ProjectTreeItem`. Replace the map on each call so it stays in sync with the current root list.
- **Add** `refreshForImage(imageUri: vscode.Uri): void` that:
  - Looks up `this._projectItemByUri.get(imageUri.toString())`
  - If found, calls `this._onDidChangeTreeData.fire(projectTreeItem)` so VS Code re-requests `getChildren(projectTreeItem)` and the “Bounding boxes” group for that image is re-fetched (and box list re-read from disk).
  - If not found (e.g. image not in workspace), no-op or optionally call `this.refresh()` for safety.

This way only that image’s row (and its “Bounding boxes” children) refresh, not the whole tree.

### 2. Extension: use scoped refresh in callbacks

**[src/extension.ts](src/extension.ts)**:

- **onBoxesChanged(imageUri)**  
  Change from `() => { ... }` to `(imageUri) => { ... }`.  
  Body: `projectProvider.refreshForImage(imageUri)` and `bboxSectionProvider.refresh()`. Optionally keep one deferred `bboxSectionProvider.refresh()` if needed for tree timing.

- **onBboxSaved**  
  The editor already calls `onBboxSaved?.(document.uri)`.  
  Change `createOnBboxSaved` so it performs a **scoped** refresh:
  - **Option A:** `createOnBboxSaved(projectProvider, bboxSectionProvider)` returns `(imageUri: vscode.Uri) => void` that calls `projectProvider.refreshForImage(imageUri)` and `bboxSectionProvider.refresh()` (with existing deferred pattern).
  - **Option B:** `createOnBboxSaved(refreshForCurrentImage: (imageUri: vscode.Uri) => void)` and in `activate` pass a lambda that does `projectProvider.refreshForImage(uri)` + `bboxSectionProvider.refresh()`.

  Option A is straightforward: pass both providers, use imageUri in the callback.

- **refreshTrees()**  
  Leave as-is (full `projectProvider.refresh()` + `bboxSectionProvider.refresh()`) and keep it only for the **Refresh** command (`bounding-box-editor.refreshView`).

### 3. Tests

- **[src/test/explorer.test.ts](src/test/explorer.test.ts):** Add a test that `refreshForImage(imageUri)` causes the provider to fire `onDidChangeTreeData` with the cached `ProjectTreeItem` for that image (e.g. after calling `getChildren(undefined)` once to populate the cache, call `refreshForImage(imageUri)` and assert the emitter was fired with the right element). Optionally assert that `refreshForImage(unknownUri)` does not throw and does not fire (or fires full refresh if we chose that fallback).
- **[src/test/extension.test.ts](src/test/extension.test.ts):** Update the `createOnBboxSaved` test: it currently calls `onBboxSaved()` with no args, but the editor calls it with `document.uri`. Change to pass a mock project provider with `refreshForImage` spy and call `onBboxSaved(imageUri)`; assert `refreshForImage` was called with that URI and bbox section refresh still happens. If we keep deferred refreshes, same timing assertions as now.

## Summary

| Trigger            | Project tree                         | Bbox section      |
|-------------------|--------------------------------------|-------------------|
| Refresh icon      | Full refresh                         | refresh           |
| onBoxesChanged(uri) | `refreshForImage(uri)` only        | refresh           |
| onBboxSaved(uri)  | `refreshForImage(uri)` only          | refresh (deferred)|

Result: the panel updates when a new box is created, and only the current image’s tree branch is refreshed instead of the entire folder.
