---
name: Labels with spaces and panel refresh
overview: Fix YOLO parsing so labels with spaces (e.g. "Drop Tower") are preserved by taking the remainder of the line as the label instead of a single token. Ensure the Bounding Boxes panel list refreshes reliably when boxes or labels change by calling refresh synchronously in onBoxesChanged in addition to the deferred refresh.
todos: []
isProject: false
---

# Labels with spaces and panel refresh

## Problem 1: Label with spaces saved as first word only

**Cause:** In [src/bbox.ts](src/bbox.ts), `parseYolo` uses a single token for the class/label:

- **Label last:** `cls = parts[4]` — so a line like `0.25 0.35 0.3 0.4 Drop Tower` yields label `"Drop"` only.
- **Class first:** `cls = parts[0]` — so `Drop Tower 0.25 0.35 0.3 0.4` yields `"Drop"` only.

Serialization is correct: the full label is written (e.g. `0.25 0.35 0.3 0.4 Drop Tower`). Only parsing truncates at the first space.

**Fix:** In `parseYolo`, treat the label as the rest of the line:

- **Label last:** Coords are the first four tokens (normalized floats). Label = `parts.slice(4).join(' ')` (same as COCO in the same file).
- **Class first:** Coords are the last four tokens (normalized floats). Label = `parts.slice(0, parts.length - 4).join(' ')`. Require `parts.length >= 5` and that `parts[parts.length-4]` through `parts[parts.length-1]` are normalized floats; then use the first N-4 tokens as the class.

Update [src/bbox.ts](src/bbox.ts) `parseYolo` accordingly. Add or adjust unit tests in [src/test/bbox.test.ts](src/test/bbox.test.ts) for a YOLO line with a multi-word label (e.g. "Drop Tower") and assert the parsed label is the full string.

---

## Problem 2: Bounding Boxes panel list not refreshed

**Cause:** Panel refresh is triggered by `onBoxesChanged`, which in [src/extension.ts](src/extension.ts) (lines 117–121) only schedules refresh with `setTimeout(..., 0)` and `setTimeout(..., 50)`. If the tree view does not re-query `getChildren` when the first tick runs, or if there is a timing/ordering issue, the list can appear stale.

**Fix:** Call `bboxSectionProvider.refresh()` once **synchronously** inside `onBoxesChanged`, then keep the existing deferred double-refresh so the tree has a second chance to update. That way the panel gets an immediate refresh and the existing workaround remains.

Change in [src/extension.ts](src/extension.ts):

```ts
onBoxesChanged: () => {
  bboxSectionProvider.refresh();  // immediate
  setTimeout(() => {
    bboxSectionProvider.refresh();
    setTimeout(() => bboxSectionProvider.refresh(), 50);
  }, 0);
},
```

No other code paths need changes for this: `onBoxesChanged` is already invoked from the dirty handler and from the `requestLabelForNewBox` callback in [src/editorProvider.ts](src/editorProvider.ts).

---

## Implementation summary


| Item                                           | Action                                                                                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/bbox.ts](src/bbox.ts)                     | In `parseYolo`: label last → `cls = parts.slice(4).join(' ')`; class first → coords from last 4 parts, `cls = parts.slice(0, parts.length - 4).join(' ')`. Validate last 4 are normalized floats and `parts.length >= 5`. |
| [src/test/bbox.test.ts](src/test/bbox.test.ts) | Add test(s) that parseYolo parses a line with multi-word label (e.g. "Drop Tower") and returns the full label.                                                                                                            |
| [src/extension.ts](src/extension.ts)           | In `onBoxesChanged`, call `bboxSectionProvider.refresh()` once before the existing `setTimeout` block.                                                                                                                    |
| [CHANGELOG.md](CHANGELOG.md)                   | Under `[Unreleased]` → `### Fixed`: mention YOLO labels with spaces now preserved when parsing; Bounding Boxes panel list refreshes immediately when boxes/labels change.                                                 |


