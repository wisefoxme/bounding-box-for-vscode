# Changelog

All notable changes to the "bounding-box-editor" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Setting **YOLO label position** (first/last) for saving class at the start or end of each YOLO line; defaults to last.
- E2E test that loads an image, creates/renames/deletes bounding boxes with saves between steps, verifies written content via mocked I/O, and asserts in-memory state and UI list. File writes are mocked to avoid disk I/O; test assertions use recorded writes instead of reading from disk. The test gracefully skips when no workspace is available (CI/CD without workspace config) and will execute when the project is opened as a workspace locally.
- After drawing or adding a bounding box, the extension prompts for a label via an input box; empty or cancel uses default "Box N".
- Context menu **Delete All** on both the image row and the "Bounding boxes" row in the Project view; prompts for confirmation and shows the number of bounding boxes to be deleted. Single-box delete remains in the context menu on each box in both the Project view and the Bounding Boxes panel.
- Command **Bounding Box Editor: Set file format** in the command palette to set the workspace bounding box file format (COCO, YOLO, or Pascal VOC) via a quick-pick.

### Changed

- YOLO label files are now saved with the label in the last column (`x_center y_center width height class`) instead of the first. Parsing still accepts both "class first" (standard) and "label last" formats.
- Delete and rename actions are no longer in the Bounding Boxes view title bar; they are only available via right-click context menu on box items (trash/rename icon appears in the menu).
- Floating-point precision when saving box coordinates is now derived from the source image size: decimal places = number of digits in the larger of width or height, capped at 8 (e.g. 1920×1080 → 4 decimals; 100×50 → 3). When dimensions are unknown or zero, 2 decimal places are used.
- Bounding box file output no longer adds a trailing newline (COCO, YOLO, Pascal VOC, Tesseract .box); none of these formats require it by spec.
- Canvas edits (move, add, delete, rename boxes) now write to the bbox file immediately on every change (e.g. on mouse release). The Bounding Boxes panel list updates after each change: add/remove refreshes the list; coordinate or label edits update the displayed item.

### Fixed

- YOLO labels with spaces (e.g. "Drop Tower") are now preserved when parsing from files; previously only the first word was saved.
- Bounding Boxes panel list now refreshes immediately when boxes or labels change, in addition to deferred refreshes.
- Bounding Boxes panel list now updates when adding or renaming a bounding box (including when the user enters the label), and tests assert panel list content.
- Bounding Boxes panel list now updates immediately when adding a new bounding box (draw or add box), without waiting for save.
- Bounding Boxes list now updates immediately when drawing a new box, without saving or switching panels.
- Bounding Boxes panel was slow to show a newly drawn box because the whole project tree was refreshed on every save; only the Bounding Boxes section is refreshed now.
- Newly added "Box N" in the Bounding Boxes panel was not editable (Rename/context menu) until refreshing or switching panels; a deferred refresh after save ensures the new item is fully usable.
- YOLO box labels are now shown in the Bounding Boxes section and Project tree (previously showed generic "Box 1", "Box 2").
- Rename and save failures now show an error toast with cause and message instead of failing silently.
- YOLO save no longer overwrites the bbox file with blank content when the image has not finished loading (dimensions were 0). Save is skipped and an error is shown until dimensions are available.
- Rename, remove, remove-all, and reveal-bbox-file now use the first **existing** bbox file in allowed-extension order (e.g. use `.box` when only that exists and `.txt` does not), instead of always using the first allowed extension path.

## [0.0.22] - 2026-02-01

### Added

- Icon to the extension (`assets/icon.png`).
- Command to package the extension (on the `package.json` file).

## [0.0.21] - 2026-02-01

### Added

- Initial Bounding Box Editor extension with image annotation editing, sidebar explorer, custom editor, and bounding box format support.
- "Bounding Boxes" section in the sidebar for managing bounding boxes of the selected image.
- Create new bounding boxes from the sidebar with automatic creation of bbox files when needed.
- Commands to remove and rename bounding boxes with selection tracking and selected box index management.
- Default bounding boxes feature for images without existing annotations.
- Setting for allowoed bounding box file extensions.
- Format providers for parsing and serializing bounding boxes (multiple format support).
- Custom bounding box colors in settings.
- Package metadata: repository, bugs, homepage, keywords, license, and author.
- CI workflow with Xvfb for the testing environment.

### Changed

- Refactored code to use format providers and improve maintainability.
- Documentation and README updates for new features and settings.
- .vscodeignore updated to exclude coverage and cursor files.
