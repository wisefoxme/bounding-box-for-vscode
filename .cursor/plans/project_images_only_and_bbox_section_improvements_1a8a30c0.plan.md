---
name: Project images only and bbox section improvements
overview: "Simplify the Project panel to show only image files (no expandable bounding box list). Keep the Bounding Boxes section and add: multi-select with Shift, Refresh and Delete All in the section title, and an \"Edit label\" context menu option for each box."
todos: []
isProject: false
---

# Project images only + Bounding Boxes section improvements

## 1. Project panel: show only images

**Current behavior:** The Project tree shows image files; each image can be expanded to show a "Bounding boxes" group, which expands to list box items ([explorer.ts](src/explorer.ts) `getChildren`: root → `ProjectTreeItem` → `BoundingBoxesGroupItem` → `BoxTreeItem[]`).

**Target:** Flat list of images only — no children, no expand arrow.

**Changes:**

- **[src/explorer.ts](src/explorer.ts)**
  - In `ProjectTreeItem` constructor: always use `vscode.TreeItemCollapsibleState.None` (remove the branch that uses `Collapsed` when `bboxUri` is set). This removes the expand arrow for all images.
  - In `getChildren(element?)`: when `element` is a `ProjectTreeItem`, return `[]` instead of `[new BoundingBoxesGroupItem(...)]`. So expanding (if it were possible) yields no children; with `None`, the tree will only show the image row.
  - Leave `BoundingBoxesGroupItem` and the rest of the provider logic in place for now (e.g. `refreshForImage` and any code that still calls `getChildren(projectItem)`); those calls will now get `[]` and can stay for minimal code churn. Optional later cleanup: remove `getParent` / `BoundingBoxesGroupItem` usage if nothing else depends on it.
- **[src/extension.ts](src/extension.ts)**
  - `revealBoxInProjectTree`: it currently finds the project item, then the group, then the box and reveals it in the project tree. After the change there are no box children in the project tree. Update it to **reveal the box in the Bounding Boxes tree** instead: resolve the selected image (e.g. `getSelectedImageUri()` or the passed `imageUri`), get children from `bboxSectionProvider.getChildren(undefined)`, find the `BoxTreeItem` whose `bboxIndex === selectedBoxIndex` (and same imageUri), then call `bboxSectionTreeView.reveal(boxItem)`. If the bbox section shows a different image, you may still set selected image and refresh so the box is visible, then reveal.
- **[package.json](package.json)** (menus)
  - Remove or narrow **view/item/context** entries that only made sense when the project tree had box/group items:
    - Remove `bounding-box-editor.removeAllBoxes` when `view == boundingBoxEditor.projectView && viewItem == imageWithBbox` and when `viewItem == bboxGroup` (or keep one for “image” if you want Delete All from an image row; per user request, only images are shown and Delete All is on the Bounding Boxes section, so removing these is consistent).
    - Remove `bounding-box-editor.renameBox`, `removeBox`, `revealBboxFile` when `view == boundingBoxEditor.projectView && viewItem == bboxItem` (no more bbox items in project view).
  - Keep **view/title** for the project view as-is (e.g. refresh only) or leave empty; do not add Delete All there (user asked for refresh/delete in the Bounding Boxes section only).

---

## 2. Bounding Boxes section: multi-select with Shift

**Current behavior:** Bbox section tree view is created without `canSelectMany` ([extension.ts](src/extension.ts) around line 198). Selection handler already supports multiple indices: `setSelectedBoxIndices(boxItems.map((b) => b.bboxIndex))`.

**Change:**

- **[src/extension.ts](src/extension.ts)**
When creating the bbox section tree view, add `**canSelectMany: true**` to the options passed to `vscode.window.createTreeView('boundingBoxEditor.bboxSectionView', { treeDataProvider: bboxSectionProvider, canSelectMany: true })`.
This allows Shift+click (and Ctrl/Cmd+click) to select multiple box items; the existing `onDidChangeSelection` handler will continue to set `setSelectedBoxIndices` to all selected box indices and refresh context.

---

## 3. Bounding Boxes section: Refresh and Delete All in the title bar

**Current behavior:** `view/title` in [package.json](package.json) is empty (`[]`). Refresh and Delete All are only in **view/item/context** (e.g. on project view items).

**Change:**

- **[package.json](package.json)**
Under `**menus.view/title**`, add two entries (order as you prefer, e.g. refresh then delete):
  - `"command": "bounding-box-editor.refreshView"`, `"when": "view == boundingBoxEditor.bboxSectionView"`, `"group": "inline"`.
  - `"command": "bounding-box-editor.removeAllBoxes"`, `"when": "view == boundingBoxEditor.bboxSectionView"`, `"group": "inline"`.
- **[src/extension.ts](src/extension.ts)**
Update `**getImageUriForRemoveAllBoxes()**` so that when the command is invoked from the Bounding Boxes view (no node passed), it uses the **selected image** that drives the bbox section list. For example: if no `node` is passed in the command handler, first try `getSelectedImageUri()`; if that is set, use it as `imageUri` for “delete all boxes for this image”. Fall back to current project tree selection logic (e.g. for callers that still pass a node or when invoked from elsewhere). That way the title-bar “Delete All” in the Bounding Boxes section deletes all boxes for the image currently shown in that section.

---

## 4. Context menu: “Edit label” for each bounding box item

**Current behavior:** The bbox section context menu has “Rename box” (`bounding-box-editor.renameBox`) when a single box is selected, plus Remove box and Reveal in file explorer.

**Change:**

- **Option A (recommended):** Add a new command that shows as “Edit label” and does the same as rename (open input, update label, refresh).
  - **[package.json](package.json)**
    - In **commands**: add e.g. `"bounding-box-editor.editLabel"` with title `"Edit label"` and icon `"$(edit)"`.
    - In **view/item/context**: add an entry for `bounding-box-editor.editLabel` when `view == boundingBoxEditor.bboxSectionView && viewItem == bboxItem` (and optionally `!boundingBoxEditor.bboxSectionMultipleBoxesSelected` if you want it only for single selection), group `1_modification`.
  - **[src/extension.ts](src/extension.ts)**
  Register the command and call the same logic as `renameBox` (e.g. `doRenameBox`), accepting the same node/selection pattern (right-clicked `BoxTreeItem` or selection).
- **Option B:** Reuse `renameBox` and add a second menu contribution with a different `title` — VS Code does not allow different titles for the same command in menus, so you’d need a new command (e.g. `editLabel`) that invokes the same handler.

Use **Option A**: new command `bounding-box-editor.editLabel`, title “Edit label”, same handler as rename.

---

## 5. Files and behavior summary


| File                                 | Changes                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/explorer.ts](src/explorer.ts)   | ProjectTreeItem always `CollapsibleState.None`; `getChildren(ProjectTreeItem)` return `[]`.                                                                                                                                                                                                                       |
| [src/extension.ts](src/extension.ts) | Bbox tree view: add `canSelectMany: true`. `revealBoxInProjectTree`: reveal in bbox section tree instead of project tree. `getImageUriForRemoveAllBoxes`: when no node, use `getSelectedImageUri()`. Register `bounding-box-editor.editLabel` (same logic as rename).                                             |
| [package.json](package.json)         | Menus: remove project-view item context entries for removeAllBoxes (image/bboxGroup), renameBox/removeBox/revealBboxFile (bboxItem). view/title: add refresh and removeAllBoxes for `boundingBoxEditor.bboxSectionView`. commands: add `editLabel`. view/item/context: add `editLabel` for bbox section bboxItem. |


---

## 6. Tests and cleanup

- **Tests:** Update any tests that depend on the project tree having expandable images or box items under the project view (e.g. explorer tests that call `getChildren(projectItem)` and expect `BoundingBoxesGroupItem` or `BoxTreeItem`). Adjust expectations to a flat list of images and no box children.
- **E2E:** If any e2e test reveals a box in the project tree, switch to asserting/using the bbox section (e.g. reveal in bbox section, or drop reveal if not needed).
- **Cleanup (optional):** After the above, `BoundingBoxesGroupItem` and `getParent` for box items are only used by the project provider’s `getChildren` (which now returns `[]` for project items). You can leave them for now or refactor later (e.g. remove `getChildren` branch that returns `BoundingBoxesGroupItem` and simplify `getParent` if nothing else uses it).

