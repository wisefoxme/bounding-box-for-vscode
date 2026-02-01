# Bounding Box Editor

A Visual Studio Code extension for viewing and editing bounding box annotations on images. It shows images with overlaid boxes and keeps annotations in text files that you can configure per workspace.

## Features

- **Sidebar view**: Activity Bar icon opens an explorer that lists your project’s images. Expand an image to see a "Bounding boxes" node and its child items (Box 1, Box 2, …). Click a box to open the image in the editor with that box selected for editing.
- **Custom editor**: Opening an image or a bounding box file opens a webview that shows the image with boxes drawn on top. Select a box (by clicking it or from the tree) and drag its edges or corners to resize, or drag the body to move. Double-click a box to delete it.
- **Configurable paths**: Use VS Code settings (user or workspace) to set where images and bounding box files live; boxes are matched to images by file name.
- **Bounding box format**: Default format is COCO (`x_min y_min width height` in pixels). You can switch to other formats (e.g. YOLO, Pascal VOC) via settings.

## Requirements

- VS Code `^1.108.1`
- No extra runtime dependencies.

## Extension Settings

Settings are read from the usual VS Code configuration (e.g. `.vscode/settings.json` for the workspace, or user settings). All support **User** and **Workspace** scope.

| Setting | Description | Default |
|--------|-------------|--------|
| `boundingBoxEditor.imageDirectory` | Path (relative to workspace root) where image files are located. | `"."` (workspace root) |
| `boundingBoxEditor.bboxDirectory` | Path (relative to workspace root) where bounding box text files are located. Leave empty or set equal to image directory to keep boxes next to images. | `""` (same as image directory) |
| `boundingBoxEditor.bboxFormat` | Bounding box file format: `"coco"`, `"yolo"`, or `"pascal_voc"`. | `"coco"` |

**Association**: A bounding box file is linked to an image when:
- Its base name (without extension) matches the image file name, and
- It lives in the configured bounding box directory (or image directory if bbox directory is not set).

Example: image `photos/sample.jpg` with default settings will use `photos/sample.txt` (or the path implied by `boundingBoxEditor.bboxDirectory` if set).

### Bounding box formats

- **COCO** (default): One line per object: `x_min y_min width height` (absolute pixels). Optional class/label can be added per line depending on your workflow.
- **YOLO**: Normalized `class x_center y_center width height` (0–1).
- **Pascal VOC**: `x_min y_min x_max y_max` (absolute pixels).

**Tree labels**: In the sidebar tree, COCO and Pascal VOC show parsed labels when available (or "Box 1", "Box 2", …). For YOLO, the tree shows generic "Box 1", "Box 2", … until you open the image in the editor (YOLO needs image dimensions to parse; full labels appear in the editor).

## Known Issues

None at this time. If you hit Webview or VS Code API quirks, workarounds are documented in this README as they are added.

## Release Notes

### 0.0.1

Initial release: sidebar explorer, custom editor with image + bounding box overlay, configurable image/bbox paths and format (COCO default).
