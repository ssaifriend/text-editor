# M6 Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make moru the daily driver: indent detection, save-time whitespace normalisation, user theme files, the five performance budgets as failing tests, packaging for macOS and Windows, and the manual release checklist that gates removing Sublime Text 3.

**Architecture:** Small, independent additions on the existing structure: a pure `indentDetect` module feeding the `indentOverride` compartment at buffer creation; pure `saveTransforms` applied as a CM6 transaction right before `fs.save`; a `themes/*.json` file service in main (same `createJsonFileService` pattern generalised to a directory) pushing `themes.changed`, merged into a renderer theme registry; perf probes exposed on `__moruTest` and measured from `tests/e2e/perf.spec.ts`; `electron-builder.yml` + a tag-triggered release workflow.

**Tech Stack:** CodeMirror 6 compartments, zod, electron-builder 26, GitHub Actions, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-08-text-editor-design.md` §1.5 (budgets), §5.6 (settings/keymap/theme, indent detection), §7 (performance tests, manual checklist), §8 M6 row.

## Global Constraints

- Budgets from §1.5, CI allowance ×2: first paint < 1000 ms (CI 2000) · RSS main+renderers with 10 files open, no terminal < 300 MB (CI 600) · typing latency p95 on a 5k-line highlighted TS file < 16 ms (CI 32) · Goto over 50k paths < 30 ms (CI 60) · open a 50k-line file < 500 ms (CI 1000). A budget test that fails is a real finding: record the number in the report, do not raise the budget silently.
- Everything else as before: IPC via zod contracts, renderer never touches disk, unsigned commits to `main`, hidden E2E.

---

### Task 1: Indent detection

**Files:** create `src/renderer/src/editor/indentDetect.ts`; modify `src/shared/config.ts` (`editor.detectIndent: boolean` default true), `src/main/config/defaultFile.ts`, `src/renderer/src/app/workspace.ts` (`extensionsFor(languageId, indent?)`, `stateFor` detects), `src/renderer/src/editor/buffers.ts` (no change: `MakeState` stays `(doc, languageId)`); test `tests/unit/renderer/indentDetect.test.ts`, E2E in `tests/e2e/settings.spec.ts` (new case).

**Interfaces:** `export type Indent = { readonly insertSpaces: boolean; readonly tabSize: number }`, `export const detectIndent = (text: string, sampleLines = 2000): Indent | null` — null when fewer than 2 indented lines. Tabs win when tab-indented lines ≥ space-indented lines. Space width = the most frequent positive indentation delta between consecutive indented lines among {2, 3, 4, 8}; fall back to the GCD-like smallest common indent.

- [ ] Test: `'a\n\tb\n\tc'` → tabs · `'a\n  b\n    c\n  d'` → spaces 2 · `'a\n    b\n        c'` → spaces 4 · `'a\nb'` → null · mixed with more tabs → tabs · leading blank/comment lines ignored.
- [ ] Implement; `stateFor(doc, languageId)` → `makeState(doc, extensionsFor(languageId, settings().editor.detectIndent ? detectIndent(doc) : null))`; `extensionsFor` puts `indentOverride.of(indent ? indentExtension(indent.tabSize, indent.insertSpaces) : [])`.
- [ ] E2E: open a 2-space file → `editorSettings().tabSize` is 2 and status bar indent label reads `Spaces: 2`; open a tab file → `Tabs`.
- [ ] Commit — `feat(editor): detect indentation on open`

### Task 2: Save-time normalisation

**Files:** create `src/renderer/src/editor/saveTransforms.ts`; modify `workspace.ts` (`saveBuffer`); test `tests/unit/renderer/saveTransforms.test.ts`, E2E new case in `tests/e2e/file.spec.ts`.

**Interfaces:** `export const saveChanges = (state: EditorState, opts: { trimTrailingWhitespace: boolean; insertFinalNewline: boolean }): ChangeSpec[]` — trailing `[ \t]+` per line (the line holding the main cursor is trimmed too, ST3 behaviour), final `\n` when the doc is non-empty and does not end with one. `saveBuffer` applies the changes as a transaction (`userEvent: 'save.normalize'`, selection mapped by CM6) to the shown view or to the buffer state, then saves the resulting text.

- [ ] Test: trims, adds newline, both, no-op for clean docs, empty doc untouched.
- [ ] E2E: settings `{ files: { trimTrailingWhitespace: true, insertFinalNewline: true } }` → type `x   ` at end of a file lacking a final newline → save → disk `…x\n`, doc equals disk, dirty false.
- [ ] Commit — `feat(files): trim trailing whitespace and insert final newline on save`

### Task 3: User themes

**Files:** create `src/shared/theme.ts` (zod `UserTheme = { id, dark, palette: Palette }`), `src/main/config/themes.ts` (dir service: read `userData/themes/*.json`, watch dir + poll, push `themes.changed { themes }`, `themes.get` invoke); modify `src/renderer/src/theme/themes.ts` (registry: `registerUserThemes(list)`, `allThemes()`, `themeById` consults registry), `App.tsx` (load + subscribe, re-apply on change), `StatusBar` theme menu if present (skip if none), ipc/channels; test `tests/unit/shared/theme.test.ts` (parse + reject bad colour), E2E `tests/e2e/theme.spec.ts` new case (write `themes/mine.json`, set theme `mine`, `.cm-editor` background equals the JSON `bg`).

- [ ] Commit — `feat(theme): user theme files in userData/themes`

### Task 4: Performance budgets

**Files:** modify `tests/e2e/perf.spec.ts`, `src/renderer/src/testHooks.ts` (`timeOpen(path): Promise<number>`, `latencyProbe(start|stop): number[]`), `tests/unit/main/indexService.test.ts` (budget 30/60 and write `test-results/perf-index.json`).

- Startup: existing `firstPaintMs` < 1000 / 2000.
- RSS: generate 10 fixture files (200 lines TS each) → `MORU_TEST_OPEN` all → wait ready → `app.getAppMetrics()` sum of `type in ['Browser','Tab']` `workingSetSize` → MB < 300 / 600. Also record the full breakdown in `test-results/perf.json`.
- Typing latency: 5k-line TS fixture; hook `latencyProbe('start')` installs a `keydown` listener recording `performance.now()` and a `requestAnimationFrame` callback that records the delta after the next paint; type 40 characters with `page.keyboard.type(text, { delay: 30 })`; p95 of samples < 16 / 32.
- Goto: unit test budget 30 ms local, 60 CI; the console number goes into the report.
- Open 50k lines: hook `timeOpen(path)` measures `await ws.openFile(path)` wall time inside the renderer; < 500 / 1000.
- [ ] Run; whatever fails stays failing in the suite — record numbers and root causes in the report, then fix what is fixable inside M6 (e.g. lazy language loading) and re-measure.
- [ ] Commit — `test(perf): budget tests for startup, memory, typing latency, goto and large files`

### Task 5: Packaging

**Files:** create `electron-builder.yml`, `.github/workflows/release.yml`, `build/icon.png` (placeholder 512×512 generated with a script — no binary committed by hand: generate a PNG via a tiny Node script using `zlib` at build time or commit a small generated PNG); modify `package.json` scripts (`package`, `package:dir`).

- `electron-builder.yml`: `appId: kr.moru.app`, `productName: moru`, `directories.output: dist`, `files: ['out/**', 'package.json']`, `asarUnpack: ['node_modules/node-pty/**', 'node_modules/@vscode/ripgrep/bin/**']`, `mac: { target: [dmg, zip], category: public.app-category.developer-tools, hardenedRuntime: false }`, `win: { target: [nsis, zip] }`, `nsis: { oneClick: false, perMachine: false }`, `npmRebuild: false`, `publish: null`.
- `release.yml`: on `push: tags: ['v*']`, matrix macos/windows, `pnpm install`, `pnpm build`, `pnpm exec electron-builder --publish never`, upload `dist/*.{dmg,zip,exe}`.
- [ ] Verify locally: `pnpm package:dir` (`electron-builder --dir`) produces `dist/mac-arm64/moru.app`; launch it with `MORU_HIDDEN=1 MORU_TEST=1` via Playwright `executablePath` smoke (optional) — at minimum `open`-less check that `Contents/MacOS/moru` exists and `node-pty` + `rg` are unpacked.
- [ ] Commit — `build: electron-builder packaging and tag release workflow`

### Task 6: Release checklist + final report

- [ ] `docs/superpowers/checklists/release-manual.md`: IME matrix (macOS 2벌식/구름, Windows MS IME/날개셋) × 8 items from the M0 checklist plus terminal; recommended fonts alignment; Claude Code 10-minute session (edit files from the agent, watch banners/reloads); CP949 legacy file round-trip; 1-week ST3 abstinence log.
- [ ] `docs/superpowers/reports/m6-transition.md` + `docs/superpowers/reports/final-status.md` (what is done per milestone, budget numbers, Windows CI status, user-side pending items).
- [ ] Commit — `docs: M6 report, release checklist and final status`
