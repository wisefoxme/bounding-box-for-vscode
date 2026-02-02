# Changelog

All notable changes to the "bounding-box-editor" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- YOLO box labels are now shown in the Bounding Boxes section and Project tree (previously showed generic "Box 1", "Box 2").
- Rename and save failures now show an error toast with cause and message instead of failing silently.

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
