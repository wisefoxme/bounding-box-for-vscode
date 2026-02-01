---
name: Bbox section and create-new
overview: Add a second view "Bounding Boxes" in the extension sidebar that shows boxes for the selected image and a "Create new bounding box" item with a "+" icon; ensure the bbox file is created automatically when the user adds a box (first save already does this; refresh trees after save).
todos: []
isProject: false
---

# Bounding Box section and create-new

## Goal

1. **Separate section** in the extension explorer: a second view that shows bounding box information for the **selected file** (the image selected in the Project tree or the image open in the custom editor).
2. **Auto-create bbox file**: When the user adds a new bounding box and no bbox file exists, create it automatically. (The editor already creates the file on first save; ensure trees refresh after save.)
3. **"Create new bounding box"** in that section: a tree item with a "+" icon that creates the bbox file if missing, opens the image editor, and adds a new default box.

## Current state

- **Single view** ([package.json](package.json)): Only `boundingBoxEditor.projectView` ("Project") under container `boundingBoxEditor`. Project tree shows images with nested "Bounding boxes" and box items.
- **Editor** ([src/editorProvider.ts](src/editorProvider.ts)): On save, writes to `document.bboxUri` with `vscode.workspace.fs.writeFile`; the bbox file is created on first write. No "add box" message from extension to webview yet.
- **Selection**: No shared "selected image" state; the new section needs it to know which file's boxes to show.

## 1. Second view in package.json

Add a second view under the same container so the sidebar has two sections (e.g. "Project" and "Bounding Boxes"):

- In [package.json](package.json) `contributes.views.boundingBoxEditor`, add:
  - `id`: `boundingBoxEditor.bboxSectionView`
  - `name`: `"Bounding Boxes"`
  - `type`: `"tree"`

## 2. Selected image state and refresh

**Selected image** drives the content of the new section. Define it as:

- The image URI of the item selected in the **Project** tree (if the user selected an image row, a "Bounding boxes" group, or a box row, resolve to that image URI).
- If nothing is selected in the Project tree: the URI of the **active editor** if it is the bounding box custom editor (image document).

**Implementation:**

- **State**: Store "selected image URI" in a small module or in the extension context (e.g. `context.globalState` or a variable). Expose `getSelectedImageUri()` and `setSelectedImageUri(uri | undefined)`.
- **Project tree selection**: In [src/explorer.ts](src/explorer.ts), when registering the Project tree view, subscribe to `treeView.onDidChangeSelection`. On change, get the selected element; if it is `ProjectTreeItem`, use `element.imageUri`; if `BoundingBoxesGroupItem`, use `element.imageUri`; if `BoxTreeItem`, use `element.imageUri`. Call `setSelectedImageUri(uri)` and refresh the Bounding Boxes view (see below).
- **Active editor**: Subscribe to `vscode.window.onDidChangeActiveTextEditor` (or the appropriate API for custom editors). When the active editor is a custom editor with viewType `boundingBoxEditor.imageEditor`, the document URI is the image URI; call `setSelectedImageUri(document.uri)` and refresh the Bounding Boxes view. (If the active editor is not our image editor, you may leave selected image as-is or clear it; prefer not clearing so the last selected image in the tree remains.)
- **Refresh**: The Bounding Boxes tree provider must expose `refresh()`. When selection or active editor changes, call that provider’s `refresh()`. When the editor saves boxes (or creates the bbox file), call refresh on both the Project tree provider and the Bounding Boxes provider so both update (Project shows "has bbox", Bounding Boxes shows the new list).

## 3. Bounding Boxes tree provider (new section)

**New file** (e.g. [src/bboxSection.ts](src/bboxSection.ts)) or a clearly named module:

- **TreeDataProvider** for view id `boundingBoxEditor.bboxSectionView`.
- **Root children** `getChildren(undefined)`:
  - If no selected image: return a single placeholder item (e.g. "Select an image from Project" or "No image selected"), non-collapsible, no command.
  - If selected image:
    - Resolve bbox file path for that image (reuse logic from [src/explorer.ts](src/explorer.ts) / [src/editorProvider.ts](src/editorProvider.ts): workspace folder, [settings](src/settings.ts) bbox dir, base name + extension).
    - If bbox file exists: read and parse (same as explorer: COCO/Pascal parse; YOLO line count or parse with 0,0). Return **first** a "Create new bounding box" item, **then** one tree item per box (same label logic as [explorer.ts](src/explorer.ts): "Box 1", "Box 2", or `bbox.label`).
    - If bbox file does not exist: return only the "Create new bounding box" item (so the user can create the file and first box).
- **Tree items**:
  - **CreateNewBoxItem**: label "Create new bounding box", `iconPath: new vscode.ThemeIcon('add')`, `contextValue: 'createBbox'`, `collapsibleState: None`. Command: `bounding-box-editor.createNewBbox` with argument `imageUri` (the selected image URI).
  - **Box items**: Same as current [BoxTreeItem](src/explorer.ts) (open image with selected box): re-use or duplicate the same item type and command `bounding-box-editor.openImageWithBox` with `[imageUri, bboxIndex]`.
- **Refresh**: Provider must fire `onDidChangeTreeData` when `refresh()` is called so the new section updates when selection or active editor changes, or when bbox file is created/updated.

## 4. Command: Create new bounding box

**New command** `bounding-box-editor.createNewBbox` in [package.json](package.json) and in extension code:

- **Argument**: `imageUri: vscode.Uri` (passed from the CreateNewBoxItem command).
- **Logic**:
  1. Resolve `bboxUri` for `imageUri` (same as editor: workspace folder + bbox dir + base name + extension).
  2. If bbox file does not exist: create it with empty content or one line (e.g. one default box in the configured format). Prefer empty file and let the webview "add box" write the first line on save, to avoid format quirks; or write one default line (e.g. COCO `0 0 100 100`) so the file exists.
  3. Set a flag so the editor adds one box when it opens: e.g. `context.workspaceState.update('addBoxOnOpen_' + imageUri.toString(), true)`.
  4. Open the image in the custom editor: `vscode.commands.executeCommand('vscode.openWith', imageUri, 'boundingBoxEditor.imageEditor')`.
- **Editor provider** ([src/editorProvider.ts](src/editorProvider.ts)): In `resolveCustomEditor`, after the webview is ready (e.g. after first `init` message from webview with `imgWidth`/`imgHeight`), check `workspaceState.get('addBoxOnOpen_' + document.uri.toString())`. If true, clear it and `webviewPanel.webview.postMessage({ type: 'addBox' })`. The webview will then add a default box, redraw, and save (see below).

## 5. Webview: handle "addBox" and ensure save creates file

- **Message "addBox"**: In the webview script in [src/editorProvider.ts](src/editorProvider.ts), add a listener for `e.data.type === 'addBox'`. On receipt: append a new box to `boxes`. Default box: e.g. center of image with default size (e.g. 10% of width/height, or 100x100), or `{ x_min: 0, y_min: 0, width: 100, height: 100 }`. Then call `draw()` and `vscode.postMessage({ type: 'save', boxes })`. That way the bbox file is created or updated by the existing save path (which already does `writeFile(bboxUri, ...)`).
- **Auto-create**: No change needed for "create file when user adds a new box" — the editor already writes to `document.bboxUri` on save; the file is created on first write. Ensure that after save you refresh both tree providers (Project and Bounding Boxes) so the UI shows the new file and new box list. That may require the editor provider to call a shared refresh callback or fire an event that the extension subscribes to (see below).

## 6. Refreshing both trees on save

When the custom editor saves (in [src/editorProvider.ts](src/editorProvider.ts) in the `msg.type === 'save'` branch), the extension must refresh:

- The **Project** tree (so the image row shows "has bbox" and becomes expandable if the file was just created).
- The **Bounding Boxes** section (so the new box appears in the list).

**Options:**

- **Event/callback**: The editor provider receives a callback (e.g. `onBboxSaved?: (imageUri: vscode.Uri) => void`) from the extension and calls it after a successful save. The extension then calls `projectTreeProvider.refresh()` and `bboxSectionProvider.refresh()`.
- **Global event**: A simple event emitter in the extension (e.g. `onBboxFileChanged`) that both the editor provider and the Bounding Boxes provider use: editor fires after save; Bounding Boxes (and Project) subscribe and call their `refresh()`.

Prefer the callback or event so the editor doesn’t depend on the Bounding Boxes module directly; the extension wires them in [src/extension.ts](src/extension.ts).

## 7. Registration in extension.ts

- Register the **Bounding Boxes** tree view with its TreeDataProvider.
- **Selection**: Pass the Project tree view instance (or its selection) and the Bounding Boxes provider into the logic that updates selected image and refreshes the Bounding Boxes view. Subscribe to Project `onDidChangeSelection` and (if desired) active editor change; update selected image and call Bounding Boxes provider `refresh()`.
- Register command **bounding-box-editor.createNewBbox** with handler that creates the bbox file if needed, sets the "addBoxOnOpen" flag, and opens the image in the custom editor.
- When creating the editor provider, pass a callback or subscribe to an event so that on save it triggers refresh of both the Project and Bounding Boxes providers.

## 8. Summary of file changes

- **[package.json](package.json):** Add view `boundingBoxEditor.bboxSectionView` ("Bounding Boxes"); add command `bounding-box-editor.createNewBbox`.
- **New module (e.g. [src/bboxSection.ts](src/bboxSection.ts)):** Bounding Boxes TreeDataProvider; "Create new bounding box" item with "+" icon; box items for selected image; reads selected image from shared state; exposes `refresh()`.
- **Selected image state:** New small module or in bboxSection/explorer: get/set selected image URI; used by Bounding Boxes provider and by selection/active-editor listeners.
- **[src/explorer.ts](src/explorer.ts):** Subscribe to Project tree `onDidChangeSelection`; on selection change, update selected image URI and refresh Bounding Boxes provider (provider reference or event).
- **[src/editorProvider.ts](src/editorProvider.ts):** After webview `init`, check "addBoxOnOpen" and postMessage `addBox`; in webview script handle `addBox` (append default box, draw, save); optionally accept an `onSave` callback and call it after save so extension can refresh both trees.
- **[src/extension.ts](src/extension.ts):** Register Bounding Boxes view and provider; register createNewBbox command; wire save callback/event to refresh Project and Bounding Boxes providers.

## 9. Tests and docs

- **Tests:** Unit tests for the Bounding Boxes provider: no selected image returns placeholder; selected image with no bbox file returns only "Create new bounding box"; selected image with bbox file returns "Create new bounding box" plus box items. Test createNewBbox command (create file if missing, set flag, open editor) with mocks if needed.
- **README:** Short note that the "Bounding Boxes" section shows boxes for the selected image and that "Create new bounding box" creates the bbox file if needed and adds a box.
