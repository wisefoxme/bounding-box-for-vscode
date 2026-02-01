---
name: Build and release pipeline
overview: "Add GitHub Actions workflows: a CI workflow that runs tests on PRs (only when extension code changes) and a release workflow that on merge to main creates a GitHub release and publishes the extension to the VS Code Marketplace using the VSCE_API_TOKEN secret."
todos: []
isProject: false
---

# Build and release pipeline for bounding-box-editor

## Current state

- No [.github](.github) directory yet; no existing CI/CD.
- Extension is built with `npm run package` (check-types, lint, esbuild production) and tested with `npm test` (vscode-test).
- [package.json](package.json) has `main: "./dist/extension.js"`, `publisher: "wisefox"`, and version `0.0.21`. No `@vscode/vsce` dependency; we will use `npx @vscode/vsce` in CI.

## 1. PR workflow: run tests only when extension code changes

**File:** `.github/workflows/ci.yml`

- **Trigger:** `pull_request` (to any branch; you can restrict to `main` if desired).
- **Single job** (e.g. `ci`) so one status check is reported and can be required in branch protection:
  - Checkout and set up Node (e.g. 20.x).
  - **Path filter:** Determine if any “extension code” file changed. Include:
    - `src/**`
    - `package.json`, `package-lock.json`
    - `esbuild.js`, `tsconfig.json`, `.vscodeignore`, `eslint.config.mjs`
  - **If extension code changed:** `npm ci`, then `npm test` (and optionally `npm run test:coverage` if you want coverage in CI).
  - **If only docs/other:** Skip tests and succeed (e.g. “Docs only, skipping tests” step that always exits 0).

**Path-filter options:**

- **Option A (recommended):** Use [dorny/paths-filter](https://github.com/dorny/paths-filter) to set an output (e.g. `code`) and run the test step only when `code == 'true'`; add a no-op success step when `code != 'true'` so the job always completes and reports one check.
- **Option B:** Manual `git diff --name-only ${{ github.event.pull_request.base.sha }} ${{ github.sha }}` and a small script that exits 0/1; then `if: success() && steps.changed.outputs.code == 'true'` for the test step.

Result: the same status check (e.g. “CI” or “test”) runs on every PR; it runs tests only when extension code changed and passes for docs-only PRs. You then **require this single check** in GitHub branch protection for `main` so PRs are mergeable only when that check passes (tests are effectively required only when code changed).

## 2. Release workflow: merge to main → GitHub release + Marketplace publish

**File:** `.github/workflows/release.yml`

- **Trigger:** `push`, `branches: [main]` (so every merge to main runs this).
- **Concurrency:** `group: release`, `cancel-in-progress: false` (avoid overlapping releases).
- **Job** (e.g. `release`):
  1. Checkout, Node 20, `npm ci`.
  2. Build: `npm run package`.
  3. Read version from `package.json` (e.g. `node -p "require('./package.json').version"`).
  4. Package VSIX: `npx @vscode/vsce package --no-dependencies` (no need to add vsce to package.json).
  5. **GitHub Release:** Create a release for tag `v<VERSION>` and upload the `.vsix` as an asset. Use either:
    - [softprops/action-gh-release](https://github.com/softprops/action-gh-release) with `tag_name: v$VERSION`, `generate_release_notes: true`, and the vsix file as an asset, or
    - `gh release create v$VERSION ./bounding-box-editor-*.vsix --generate-notes` (uses `GITHUB_TOKEN`).
  6. **Marketplace:** `npx @vscode/vsce publish -p ${{ secrets.VSCE_API_TOKEN }}`.

**Secrets:**

- `VSCE_API_TOKEN`: you provide this (Personal Access Token for the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/manage)); store it in the repo’s GitHub Actions secrets.
- `GITHUB_TOKEN`: provided by GitHub; no need to add it. Used to create the release and tag.

**Versioning:** The version in `package.json` is the source of truth. Before merging to main, the version must be bumped (e.g. in the same PR or a dedicated one). If the same version is merged twice, the workflow will create a duplicate tag/release or vsce will fail on publish; consider adding an early step that checks whether tag `v<VERSION>` already exists and fails with a clear message so the team bumps the version first.

## 3. Branch protection (manual step)

In GitHub: **Settings → Branches → Branch protection rule for `main**`:

- Require status checks before merging.
- Add the **single CI check** from the PR workflow (e.g. “ci” or the job name from `ci.yml`).
- No need to require “release” (release runs only on push to main, not on PRs).

## 4. Optional: path filter for release

To avoid running the release workflow on docs-only pushes to main, you can add a path filter so the release job runs only when extension code (same list as in CI) or version-related files (e.g. `package.json`, `CHANGELOG.md`) change. If you prefer “every merge to main releases,” skip this and run release on every push to main.

## Summary


| Item              | Action                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRs               | One workflow runs on every PR; one job runs tests only when extension code (src, package.json, build config, etc.) changed; same job always reports one status. |
| Branch protection | Require that single CI check for `main`.                                                                                                                        |
| Merge to main     | Second workflow builds, packages vsix, creates GitHub release with tag `v<VERSION>` and vsix asset, then runs `vsce publish` using `VSCE_API_TOKEN`.            |
| Secrets           | Add `VSCE_API_TOKEN` in the repo’s GitHub Actions secrets.                                                                                                      |


**Publisher note:** [package.json](package.json) uses `"publisher": "wisefox"`. The Personal Access Token used as `VSCE_API_TOKEN` must belong to the same publisher account that owns the extension on the Marketplace; otherwise publish will fail.