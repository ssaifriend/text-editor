# M1c Settings, Theme, Status Menus, Banner, Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish M1 ("메모장 대체"): settings drive the editor and hot-reload, dark/light themes, status-bar menus for encoding/EOL/syntax/indent, a per-buffer banner for save conflicts and lossy encodings, a dirty store that survives SIGKILL, and a user `keymap.json` overlay with conflict reporting.

**Architecture:** The renderer keeps a `settings` signal fed by `config.get` and the `config.changed` push. Every buffer `EditorState` contains one shared `settingsCompartment` whose content is computed from `resolveForLanguage(settings, languageId)`; on change the workspace reconfigures every buffer (dispatching to views for displayed buffers, updating stored states for the rest). A `Buffer` now carries a `saved` snapshot (`doc`, `encoding`, `bom`, `eol`) so changing EOL or encoding marks it dirty. Banners are workspace state keyed by buffer id. The dirty store is written 1 s after the last edit (5 s max) and read back on startup. `keymap.json` follows the same main-side service pattern as `settings.json`.

**Tech Stack:** Solid.js, CodeMirror 6 (`Compartment`, `EditorState.tabSize`, `indentUnit`, `EditorView.lineWrapping`, `lineNumbers`, `highlightWhitespace`, `EditorView.theme`, `HighlightStyle`), `@lezer/highlight` tags, zod, jsonc-parser.

**Spec:** `docs/superpowers/specs/2026-09-08-text-editor-design.md` — §4.3 dirty store, §4.5/§6.1 배너, §5.1 인코딩 메뉴, §5.6 설정·키맵·테마, §8 M1 수용 기준 (dirty store + 크래시 복원).

## Global Constraints

- Settings changes never rebuild a buffer's `EditorState` from scratch (that would drop undo history); they reconfigure a compartment.
- `EditorHost` keeps its effect keyed on the active buffer id only. Reconfiguration must go through `view.dispatch` for displayed buffers and update the registry from `view.state` afterwards.
- File content is never normalized. Changing EOL or encoding in the status bar changes the *pending save format* and marks the buffer dirty; bytes change only on save.
- Reinterpreting encoding re-reads the file from disk with the forced encoding; it is refused while the buffer is dirty (status message), because it would discard edits.
- Banner is the only surface for `conflict`, `encodingLossy`, `readonly` (spec §6.1). The status text is for transient info.
- Dirty store entries are written only for dirty buffers, cleared on save/close, and restored on startup before the startup paths open. Loss window ≤ 1 s.
- Test mode env: `MORU_TEST_CONFIRM` as before; new `MORU_USER_DATA` reuse across launches for the crash test.
- TS strict, ts-belt, functional style. Conventional commits after each task.

## File Structure

```
src/shared/ipc.ts, channels.ts        # (modify) keymap.get / keymap.changed
src/shared/keymapFile.ts              # Binding zod schema, parseKeymapText
src/main/config/service.ts            # (modify) generic JSONC file service used for settings and keymap
src/main/config/keymapDefaults.ts     # default keymap.json text (commented, empty overlay)
src/main/ipc/handlers.ts, index.ts    # (modify) keymap service wiring

src/renderer/src/app/settings.ts      # settings signal + subscribe
src/renderer/src/editor/editorConfig.ts  # settingsCompartment, configExtensions(EditorSettings)
src/renderer/src/theme/themes.ts      # moru-dark / moru-light: css vars + CM6 theme + highlight style
src/renderer/src/theme/apply.ts       # applyTheme(name): sets css vars + data-theme
src/renderer/src/editor/buffers.ts    # (modify) saved snapshot, withEol/withEncoding, isDirty covers format
src/renderer/src/app/workspace.ts     # (modify) settings reconfigure, format commands, banners, dirty store, restore
src/renderer/src/app/registerCommands.ts  # (modify) buffer.* commands, keymap.showConflicts
src/renderer/src/app/dirtySync.ts     # debounce writer
src/renderer/src/ui/statusbar/StatusBar.tsx  # (modify) clickable items
src/renderer/src/ui/statusbar/Popup.tsx      # list popup
src/renderer/src/ui/banner/Banner.tsx
src/renderer/src/ui/layout/PaneView.tsx      # (modify) banner slot
src/renderer/src/App.tsx, testHooks.ts       # (modify)
src/renderer/src/style.css                   # (modify)

tests/unit/renderer/editorConfig.test.ts
tests/unit/renderer/buffers.test.ts          # (modify) format dirty
tests/unit/shared/keymapFile.test.ts
tests/unit/renderer/dirtySync.test.ts
tests/e2e/launch.ts                          # (modify) userData option
tests/e2e/settings.spec.ts
tests/e2e/theme.spec.ts
tests/e2e/statusbar.spec.ts
tests/e2e/banner.spec.ts
tests/e2e/recovery.spec.ts
tests/e2e/userKeymap.spec.ts
docs/superpowers/reports/m1c-settings-and-recovery.md
```

---

### Task 1: Settings drive the editor (compartment) and hot-reload

**Files:**
- Create: `src/renderer/src/app/settings.ts`, `src/renderer/src/editor/editorConfig.ts`
- Modify: `src/renderer/src/app/workspace.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/testHooks.ts`, `src/renderer/src/style.css`
- Test: `tests/unit/renderer/editorConfig.test.ts`, `tests/e2e/settings.spec.ts`

**Interfaces:**
- `settings.ts`: `createSettings(): { settings: Accessor<Settings>; error: Accessor<string | null>; load(): Promise<void>; subscribe(): () => void }` — `load` calls `config.get`; `subscribe` listens to `config.changed`.
- `editorConfig.ts`: `settingsCompartment: Compartment` (module singleton), `configExtensions(s: EditorSettings): Extension` → `[EditorState.tabSize.of(s.tabSize), indentUnit.of(s.insertSpaces ? ' '.repeat(s.tabSize) : '\t'), s.wordWrap ? EditorView.lineWrapping : [], s.lineNumbers ? lineNumbers() : [], s.highlightWhitespace ? highlightWhitespace() : [], rulers(s.rulers)]` where `rulers` is a tiny theme extension drawing nothing in M1c (returns `[]` when empty; otherwise `EditorView.theme` with a background-position hint is out of scope → return `[]` and note). `applyEditorFont(s)`: sets `--font-mono` and `--font-size` on `document.documentElement`.
- Workspace: `stateFor(doc, languageId)` includes `settingsCompartment.of(configExtensions(resolveForLanguage(settings(), languageId)))`; `applySettings(settings: Settings)` reconfigures every buffer; `lineNumbers()` moves out of `baseExtensions` into `configExtensions`.
- Test hook: `editorSettings(): { tabSize: number; indentUnit: string; lineNumbers: boolean; wordWrap: boolean }` read from the active view state/DOM.

- [x] **Step 1: Write failing tests**

`tests/unit/renderer/editorConfig.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { indentUnit } from '@codemirror/language'
import { defaultSettings } from '@shared/config'
import { configExtensions, settingsCompartment } from '@renderer/editor/editorConfig'

const stateWith = (overrides: Partial<typeof defaultSettings.editor>) =>
  EditorState.create({ extensions: settingsCompartment.of(configExtensions({ ...defaultSettings.editor, ...overrides })) })

describe('configExtensions', () => {
  it('applies tab size and indent unit from settings', () => {
    const spaces = stateWith({ tabSize: 2, insertSpaces: true })
    expect(spaces.facet(EditorState.tabSize)).toBe(2)
    expect(spaces.facet(indentUnit)).toBe('  ')

    const tabs = stateWith({ tabSize: 8, insertSpaces: false })
    expect(tabs.facet(EditorState.tabSize)).toBe(8)
    expect(tabs.facet(indentUnit)).toBe('\t')
  })

  it('can be reconfigured in place without touching the doc', () => {
    const state = EditorState.create({ doc: 'x', extensions: settingsCompartment.of(configExtensions(defaultSettings.editor)) })
    const next = state.update({ effects: settingsCompartment.reconfigure(configExtensions({ ...defaultSettings.editor, tabSize: 3 })) }).state
    expect(next.facet(EditorState.tabSize)).toBe(3)
    expect(next.doc.toString()).toBe('x')
  })
})
```

`tests/e2e/settings.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')

test('settings.json changes reconfigure open editors without losing text or undo', async () => {
  const { app, page, userData } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(() => page.evaluate(() => window.__moruTest!.editorSettings().tabSize)).toBe(4)
  await expect(page.locator('.cm-gutters')).toHaveCount(1)

  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('// edited ')

  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ editor: { tabSize: 2, lineNumbers: false, wordWrap: true } }))

  await expect.poll(() => page.evaluate(() => window.__moruTest!.editorSettings()), { timeout: 10_000 }).toMatchObject({ tabSize: 2, indentUnit: '  ', lineNumbers: false, wordWrap: true })
  await expect(page.locator('.cm-gutters')).toHaveCount(0)
  expect(await page.evaluate(() => window.__moruTest!.doc())).toContain('// edited ')

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).not.toContain('// edited')

  await app.close()
})

test('language overrides apply per buffer', async () => {
  const { app, page, userData } = await launchApp({ MORU_TEST_OPEN: fixture })
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ editor: { tabSize: 4 }, languages: { typescript: { tabSize: 3 } } }))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.editorSettings().tabSize), { timeout: 10_000 }).toBe(3)

  await page.evaluate(() => window.__moruTest!.runCommand('file.new'))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.editorSettings().tabSize)).toBe(4)

  await app.close()
})
```

`launchApp` returns `userData` (add to `Launched`) and accepts `{ userData?: string }` as a second argument (Task 5 needs reuse).

- [x] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/renderer/editorConfig.test.ts; pnpm build && pnpm exec playwright test tests/e2e/settings.spec.ts`
Expected: FAIL.

- [x] **Step 3: Implement**

`src/renderer/src/editor/editorConfig.ts`:
```ts
import { indentUnit } from '@codemirror/language'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, highlightWhitespace, lineNumbers } from '@codemirror/view'
import type { EditorSettings } from '@shared/config'

export const settingsCompartment = new Compartment()

export const configExtensions = (s: EditorSettings): Extension => [
  EditorState.tabSize.of(s.tabSize),
  indentUnit.of(s.insertSpaces ? ' '.repeat(s.tabSize) : '\t'),
  s.wordWrap ? EditorView.lineWrapping : [],
  s.lineNumbers ? lineNumbers() : [],
  s.highlightWhitespace ? highlightWhitespace() : [],
]

export const applyEditorFont = (s: EditorSettings, root: HTMLElement = document.documentElement): void => {
  root.style.setProperty('--font-mono', s.fontFamily.map((f) => (f.includes(' ') ? `"${f}"` : f)).join(', '))
  root.style.setProperty('--font-size', `${s.fontSize}px`)
}
```

`src/renderer/src/app/settings.ts`:
```ts
import { createSignal, type Accessor } from 'solid-js'
import { R } from '@mobily/ts-belt'
import { type Settings, defaultSettings } from '@shared/config'
import { invoke, on } from '../ipc'

export type SettingsStore = {
  readonly settings: Accessor<Settings>
  readonly error: Accessor<string | null>
  readonly load: () => Promise<void>
  readonly subscribe: () => () => void
}

export const createSettings = (): SettingsStore => {
  const [settings, setSettings] = createSignal<Settings>(defaultSettings)
  const [error, setError] = createSignal<string | null>(null)

  const accept = (snapshot: { settings: Settings; error: string | null }): void => {
    setSettings(snapshot.settings)
    setError(snapshot.error)
  }

  return {
    settings,
    error,
    load: async () => {
      const result = await invoke('config.get', undefined)
      R.tap(result, accept)
    },
    subscribe: () => on('config.changed', accept),
  }
}
```

Workspace changes (`src/renderer/src/app/workspace.ts`):
- `createWorkspace(deps)` gains `settings: Accessor<Settings>` in `Deps`.
- `stateFor(doc, languageId)`:
  ```ts
  makeState(doc, [
    baseExtensions(languageById(languageId).load(), { onUpdate }),
    settingsCompartment.of(configExtensions(resolveForLanguage(deps.settings(), languageId))),
  ])
  ```
- New `applySettings(next: Settings)`:
  ```ts
  const applySettings = (next: Settings): void => {
    D.values(buffers).forEach((buffer) => {
      const effects = settingsCompartment.reconfigure(configExtensions(resolveForLanguage(next, buffer.languageId)))
      const view = viewShowing(buffer.id)
      if (view) {
        view.dispatch({ effects })
        putBuffer({ ...buffer, state: view.state })
      } else {
        putBuffer({ ...buffer, state: buffer.state.update({ effects }).state })
      }
    })
  }
  ```
  with `viewShowing(bufferId)` = the view of the pane whose active tab is this buffer.
- Expose `applySettings` on `Workspace`.
- Remove `lineNumbers()` from `baseExtensions` in `createEditor.ts` (it now comes from settings).

`App.tsx`:
```ts
const settingsStore = createSettings()
const ws = createWorkspace({ confirmClose, settings: settingsStore.settings })
createEffect(on(settingsStore.settings, (s) => { applyEditorFont(s.editor); ws.applySettings(s) }, { defer: true }))
// in onMount before bootstrap:
await settingsStore.load()
applyEditorFont(settingsStore.settings().editor)
onCleanup(settingsStore.subscribe())
```

`style.css`: `font-size: var(--font-size, 13px)` on `html, body, #root` and `.cm-scroller { font-family: var(--font-mono); font-size: var(--font-size, 13px) }`.

`testHooks.ts` — add:
```ts
editorSettings(): { tabSize: number; indentUnit: string; lineNumbers: boolean; wordWrap: boolean }
// impl:
editorSettings: () => {
  const v = view()
  return {
    tabSize: v.state.facet(EditorState.tabSize),
    indentUnit: v.state.facet(indentUnit),
    lineNumbers: v.dom.querySelector('.cm-gutters') !== null,
    wordWrap: v.state.facet(EditorView.lineWrapping) as unknown as boolean === true || v.contentDOM.style.whiteSpace.includes('pre-wrap'),
  }
},
```
(Use `v.contentDOM.style.whiteSpace === 'pre-wrap' || v.contentDOM.style.whiteSpace === 'break-spaces'` for `wordWrap` — `EditorView.lineWrapping` is an extension, not a facet you can read.)

`tests/e2e/launch.ts`:
```ts
export type Launched = { readonly app: ElectronApplication; readonly page: Page; readonly userData: string }
export const launchApp = async (env: Record<string, string> = {}, options: { userData?: string } = {}): Promise<Launched> => {
  const userData = options.userData ?? mkdtempSync(join(tmpdir(), 'moru-e2e-'))
  ...
  return { app, page, userData }
}
```

- [x] **Step 4: Run**

Run: `pnpm typecheck && pnpm test && pnpm build && pnpm exec playwright test tests/e2e/settings.spec.ts tests/e2e/ime.spec.ts tests/e2e/tabs.spec.ts`
Expected: PASS. Note the config service watches `userData` with `fs.watch`; on macOS the change event is delivered within ~100–500 ms, hence the 10 s poll timeout.

- [x] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "feat(settings): drive tab size, indent, wrap, gutters, whitespace and font from settings with hot reload"
```

---

### Task 2: Themes

**Files:**
- Create: `src/renderer/src/theme/themes.ts`, `src/renderer/src/theme/apply.ts`
- Modify: `src/renderer/src/editor/createEditor.ts` (drop `defaultHighlightStyle`; theme compartment), `src/renderer/src/app/workspace.ts` (theme reconfigure with settings), `src/renderer/src/App.tsx`, `src/renderer/src/style.css`
- Test: `tests/e2e/theme.spec.ts`

**Interfaces:**
- `Theme = { id: string; dark: boolean; vars: Record<string, string>; editor: Extension }`; `themes: readonly Theme[]` with `moru-dark` (Mariana-inspired) and `moru-light`; `themeById(id): Theme` (falls back to dark).
- `themeCompartment: Compartment`; `applyTheme(theme, root = document.documentElement)` sets every var and `root.dataset.theme = theme.id`.
- Workspace `applySettings` also reconfigures `themeCompartment.reconfigure(themeById(next.theme).editor)`.

- [x] **Step 1: Write the failing E2E**

`tests/e2e/theme.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')

test('theme setting switches css variables and the CodeMirror theme', async () => {
  const { app, page, userData } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset['theme'])).toBe('moru-dark')
  const darkBg = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-editor')!).backgroundColor)

  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ theme: 'moru-light' }))
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset['theme']), { timeout: 10_000 }).toBe('moru-light')
  const lightBg = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-editor')!).backgroundColor)

  expect(lightBg).not.toBe(darkBg)
  await expect(page.locator('.cm-editor.cm-light')).toHaveCount(1)
  await app.close()
})
```

- [x] **Step 2: Run to verify failure** — `pnpm build && pnpm exec playwright test tests/e2e/theme.spec.ts` → FAIL.

- [x] **Step 3: Implement**

`src/renderer/src/theme/themes.ts`:
```ts
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { A, O, pipe } from '@mobily/ts-belt'

export type Theme = {
  readonly id: string
  readonly dark: boolean
  readonly vars: Record<string, string>
  readonly editor: Extension
}

type Palette = {
  bg: string; fg: string; bar: string; border: string; selection: string; cursor: string; activeLine: string; gutter: string
  keyword: string; string: string; comment: string; number: string; fn: string; type: string; variable: string; operator: string; heading: string; link: string
}

const build = (id: string, dark: boolean, p: Palette): Theme => ({
  id,
  dark,
  vars: { '--bg': p.bg, '--fg': p.fg, '--bar': p.bar, '--border': p.border, '--selection': p.selection },
  editor: [
    EditorView.theme(
      {
        '&': { backgroundColor: p.bg, color: p.fg },
        '.cm-content': { caretColor: p.cursor },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: p.cursor },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: p.selection },
        '.cm-activeLine': { backgroundColor: p.activeLine },
        '.cm-gutters': { backgroundColor: p.bg, color: p.gutter, borderRight: `1px solid ${p.border}` },
        '.cm-activeLineGutter': { backgroundColor: p.activeLine },
        '.cm-selectionMatch': { backgroundColor: p.selection },
        '.cm-matchingBracket': { outline: `1px solid ${p.gutter}` },
      },
      { dark },
    ),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: p.keyword },
        { tag: [t.string, t.special(t.string), t.character], color: p.string },
        { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: p.comment, fontStyle: 'italic' },
        { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom], color: p.number },
        { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: p.fn },
        { tag: [t.typeName, t.className, t.namespace, t.tagName], color: p.type },
        { tag: [t.variableName, t.propertyName, t.attributeName, t.definition(t.variableName)], color: p.variable },
        { tag: [t.operator, t.punctuation, t.bracket], color: p.operator },
        { tag: [t.heading, t.heading1, t.heading2, t.heading3], color: p.heading, fontWeight: 'bold' },
        { tag: [t.link, t.url], color: p.link, textDecoration: 'underline' },
        { tag: t.strong, fontWeight: 'bold' },
        { tag: t.emphasis, fontStyle: 'italic' },
        { tag: t.strikethrough, textDecoration: 'line-through' },
        { tag: t.invalid, color: '#ff5f5f' },
      ]),
    ),
  ],
})

export const themes: readonly Theme[] = [
  build('moru-dark', true, {
    bg: '#1e2227', fg: '#d5dae0', bar: '#2b3038', border: '#3d4450', selection: '#3a4a5c', cursor: '#f9ae58', activeLine: '#242930', gutter: '#5c6773',
    keyword: '#c695c6', string: '#99c794', comment: '#a6acb9', number: '#f9ae58', fn: '#5fb4b4', type: '#fac863', variable: '#d5dae0', operator: '#f97b58', heading: '#6699cc', link: '#5fb4b4',
  }),
  build('moru-light', false, {
    bg: '#fbfbfb', fg: '#24292f', bar: '#eef0f3', border: '#d0d7de', selection: '#c7dcf3', cursor: '#0969da', activeLine: '#f3f5f8', gutter: '#8c959f',
    keyword: '#8250df', string: '#0a3069', comment: '#6e7781', number: '#0550ae', fn: '#8250df', type: '#953800', variable: '#24292f', operator: '#cf222e', heading: '#0969da', link: '#0969da',
  }),
]

export const themeById = (id: string): Theme =>
  pipe(
    themes,
    A.find((th) => th.id === id),
    O.getWithDefault(themes[0] as Theme),
  )
```

`src/renderer/src/theme/apply.ts`:
```ts
import { Compartment } from '@codemirror/state'
import type { Theme } from './themes'

export const themeCompartment = new Compartment()

export const applyTheme = (theme: Theme, root: HTMLElement = document.documentElement): void => {
  Object.entries(theme.vars).forEach(([name, value]) => root.style.setProperty(name, value))
  root.dataset['theme'] = theme.id
}
```

`createEditor.ts`: remove `syntaxHighlighting(defaultHighlightStyle, { fallback: true })` from `baseExtensions` (the theme provides highlighting).

Workspace: `stateFor` adds `themeCompartment.of(themeById(deps.settings().theme).editor)`; `applySettings` dispatches both `settingsCompartment.reconfigure(...)` and `themeCompartment.reconfigure(themeById(next.theme).editor)` in one `effects` array.

`App.tsx`: in the settings effect and after `load()`: `applyTheme(themeById(s.theme))`.

`style.css`: replace hard-coded `#3d4450` with `var(--border)`; `.pane.active { border-color: var(--border) }`; `.tab { color: color-mix(in srgb, var(--fg) 60%, transparent) }`; `.palette { border-color: var(--border) }`; `.palette-item.selected { background: var(--selection) }`.

- [x] **Step 4: Run** — `pnpm typecheck && pnpm build && pnpm exec playwright test tests/e2e/theme.spec.ts tests/e2e/ime.spec.ts` → PASS.

- [x] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "feat(theme): moru-dark and moru-light themes driving css variables and CodeMirror highlighting"
```

---

### Task 3: Saved-format snapshot and status bar menus (encoding, EOL, syntax, indent)

**Files:**
- Modify: `src/renderer/src/editor/buffers.ts`, `src/renderer/src/app/workspace.ts`, `src/renderer/src/app/registerCommands.ts`, `src/renderer/src/ui/statusbar/StatusBar.tsx`, `src/renderer/src/testHooks.ts`, `src/renderer/src/style.css`, `tests/unit/renderer/buffers.test.ts`
- Create: `src/renderer/src/ui/statusbar/Popup.tsx`
- Test: `tests/e2e/statusbar.spec.ts`

**Interfaces:**
- `Buffer` gains `format: { encoding: EncodingName; bom: boolean; eol: Eol }` (pending save format) and `saved: { doc: Text; encoding: EncodingName; bom: boolean; eol: Eol }`; `savedDoc` is removed. `isDirty(b)` = doc differs **or** format differs from `saved`. `markSaved(b, meta)` sets `saved` from `meta` and `format` = saved. `withFormat(b, patch: Partial<Format>)`. `createBuffer` for untitled uses `{ encoding: 'utf8', bom: false, eol: 'lf' }` (from `files.defaultEncoding` / `defaultEol` in the workspace when creating).
- Workspace actions: `setEol(eol)`, `setEncoding(encoding, bom)` (pending format), `reinterpret(encoding)` (re-read; refused when dirty), `setLanguage(languageId)` (uses `withLanguage`, keeps `saved`), `setIndent(tabSize, insertSpaces)` (per-buffer override via a second compartment `bufferIndentCompartment`).
- Commands: `buffer.setEol` (args `Eol`), `buffer.setEncoding` (args `{ encoding, bom }`), `buffer.reinterpret` (args `EncodingName`), `buffer.setLanguage` (args `string`), `buffer.setIndent` (args `{ tabSize, insertSpaces }`), each `when: 'hasBuffer'` (new context key: active buffer exists).
- `Popup` component: `{ items: { label: string; active?: boolean; onSelect(): void }[]; onClose(): void; anchor: HTMLElement }` rendered above the status bar; Escape/outside click closes.
- Status bar items get `data-testid` `encoding`, `eol`, `language`, `indent` and open popups; popup items `data-testid="popup-item"`.
- Test hooks: `format(): { encoding, bom, eol } | null`, `dirty(): boolean`.

- [x] **Step 1: Write failing tests**

Add to `tests/unit/renderer/buffers.test.ts`:
```ts
import { withFormat } from '@renderer/editor/buffers'

  it('changing the pending EOL or encoding marks the buffer dirty until saved', () => {
    const b = createBuffer('b1', opened, makeState)
    const crlf = withFormat(b, { eol: 'crlf' })
    expect(isDirty(crlf)).toBe(true)
    expect(crlf.state.doc.toString()).toBe('hello')

    const saved = markSaved(crlf, { ...opened, eol: 'crlf', hash: 'h3' })
    expect(isDirty(saved)).toBe(false)
    expect(saved.format.eol).toBe('crlf')

    expect(isDirty(withFormat(saved, { encoding: 'cp949' }))).toBe(true)
    expect(isDirty(withFormat(saved, { bom: true }))).toBe(true)
  })
```

`tests/e2e/statusbar.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import iconv from 'iconv-lite'
import { launchApp } from './launch'

const tempFile = (name: string, bytes: Buffer) => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-status-'))
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return path
}

test('EOL menu changes the pending line ending, marks dirty, and save writes CRLF', async () => {
  const path = tempFile('a.txt', Buffer.from('a\nb\n'))
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await expect(page.getByTestId('eol')).toHaveText('LF')

  await page.getByTestId('eol').click()
  await page.getByTestId('popup-item', { hasText: 'CRLF' }).click()
  await expect(page.getByTestId('eol')).toHaveText('CRLF')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.dirty())).toBe(true)

  await page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.dirty())).toBe(false)
  expect(readFileSync(path, 'utf8')).toBe('a\r\nb\r\n')
  await app.close()
})

test('encoding menu: save as UTF-8 BOM, and reinterpret re-reads bytes with the chosen encoding', async () => {
  const path = tempFile('k.txt', iconv.encode('가나\n', 'cp949'))
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await expect(page.getByTestId('encoding')).toHaveText('CP949')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('가나\n')

  await page.getByTestId('encoding').click()
  await page.getByTestId('popup-item', { hasText: 'Reinterpret as Latin-1' }).click()
  await expect(page.getByTestId('encoding')).toHaveText('Latin-1')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).not.toBe('가나\n')

  await page.getByTestId('encoding').click()
  await page.getByTestId('popup-item', { hasText: 'Reinterpret as CP949' }).click()
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('가나\n')

  await page.getByTestId('encoding').click()
  await page.getByTestId('popup-item', { hasText: 'Save with UTF-8 BOM' }).click()
  await expect(page.getByTestId('encoding')).toHaveText('UTF-8 BOM')
  await page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.dirty())).toBe(false)
  expect([...readFileSync(path).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  expect(readFileSync(path).subarray(3).toString('utf8')).toBe('가나\n')
  await app.close()
})

test('reinterpret is refused while the buffer is dirty', async () => {
  const path = tempFile('k.txt', iconv.encode('가\n', 'cp949'))
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.type('x')

  await page.evaluate(() => window.__moruTest!.runCommand('buffer.reinterpret', 'latin1'))
  await expect(page.getByTestId('status')).toContainText('save or revert')
  await expect(page.getByTestId('encoding')).toHaveText('CP949')
  await app.close()
})

test('syntax menu switches the language and indent menu sets tab size per buffer', async () => {
  const path = tempFile('plain.txt', Buffer.from('x'))
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await expect(page.getByTestId('language')).toHaveText('Plain Text')

  await page.getByTestId('language').click()
  await page.getByTestId('popup-item', { hasText: 'Python' }).click()
  await expect(page.getByTestId('language')).toHaveText('Python')
  expect(await page.evaluate(() => window.__moruTest!.dirty())).toBe(false)

  await page.getByTestId('indent').click()
  await page.getByTestId('popup-item', { hasText: 'Tab Width: 2' }).click()
  await expect(page.getByTestId('indent')).toHaveText('Spaces: 2')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.editorSettings().tabSize)).toBe(2)

  await page.getByTestId('indent').click()
  await page.getByTestId('popup-item', { hasText: 'Indent Using Tabs' }).click()
  await expect(page.getByTestId('indent')).toHaveText('Tabs: 2')
  await app.close()
})
```

- [x] **Step 2: Run to verify failure** — unit and the four E2E tests FAIL.

- [x] **Step 3: Implement**

`src/renderer/src/editor/buffers.ts` (replace the type and helpers):
```ts
import { EditorSelection, type EditorState, type Text } from '@codemirror/state'
import type { EncodingName, Eol } from '@shared/encoding'
import type { OpenedFile } from '@shared/ipc'
import { basenameOf, languageFor } from './lang'

export type BufferId = string
export type FileMeta = Omit<OpenedFile, 'text'>
export type MakeState = (doc: string, languageId: string) => EditorState
export type Format = { readonly encoding: EncodingName; readonly bom: boolean; readonly eol: Eol }
export type Saved = Format & { readonly doc: Text }

export type Buffer = {
  readonly id: BufferId
  readonly meta: FileMeta | null
  readonly languageId: string
  readonly state: EditorState
  readonly format: Format
  readonly saved: Saved
}

const stripText = ({ text: _text, ...meta }: OpenedFile): FileMeta => meta

const formatOf = (meta: Format): Format => ({ encoding: meta.encoding, bom: meta.bom, eol: meta.eol })

export const createBuffer = (id: BufferId, file: OpenedFile | null, makeState: MakeState, untitledFormat: Format): Buffer => {
  const languageId = file ? languageFor(file.path).id : 'plain'
  const state = makeState(file?.text ?? '', languageId)
  const format = file ? formatOf(file) : untitledFormat

  return { id, meta: file ? stripText(file) : null, languageId, state, format, saved: { ...format, doc: state.doc } }
}

const sameFormat = (a: Format, b: Format): boolean => a.encoding === b.encoding && a.bom === b.bom && a.eol === b.eol

export const isDirty = (buffer: Buffer): boolean =>
  !buffer.state.doc.eq(buffer.saved.doc) || !sameFormat(buffer.format, buffer.saved)

export const titleOf = (buffer: Buffer): string => (buffer.meta ? basenameOf(buffer.meta.path) : 'untitled')

export const withState = (buffer: Buffer, state: EditorState): Buffer => ({ ...buffer, state })

export const withFormat = (buffer: Buffer, patch: Partial<Format>): Buffer => ({ ...buffer, format: { ...buffer.format, ...patch } })

export const markSaved = (buffer: Buffer, meta: FileMeta): Buffer => ({
  ...buffer,
  meta,
  format: formatOf(meta),
  saved: { ...formatOf(meta), doc: buffer.state.doc },
})

export const replaceContents = (buffer: Buffer, file: OpenedFile, makeState: MakeState): Buffer => {
  const state = makeState(file.text, buffer.languageId)
  return { ...buffer, meta: stripText(file), state, format: formatOf(file), saved: { ...formatOf(file), doc: state.doc } }
}

export const withLanguage = (buffer: Buffer, languageId: string, makeState: MakeState): Buffer => {
  const fresh = makeState(buffer.state.doc.toString(), languageId)
  const ranges = buffer.state.selection.ranges.map((r) => EditorSelection.range(r.anchor, r.head))
  const state = fresh.update({ selection: EditorSelection.create(ranges, buffer.state.selection.mainIndex) }).state

  return { ...buffer, languageId, state }
}
```

Update the existing buffers unit tests: `createBuffer(id, file, makeState, { encoding: 'utf8', bom: false, eol: 'lf' })`.

Workspace:
- `untitledFormat()` from settings: `{ encoding: settings().files.defaultEncoding, bom: false, eol: settings().files.defaultEol === 'crlf' ? 'crlf' : 'lf' }`.
- `saveBuffer` uses `buffer.format` instead of `buffer.meta` for encoding/bom/eol and sends `expectedHash: buffer.meta?.path === path ? buffer.meta.hash : null`.
- New actions (all operate on the active buffer; `updateActive(f)` helper applies `f` and, when the buffer is displayed, calls `view.setState` only if the `EditorState` object changed and the doc changed — for `withLanguage`/`replaceContents` the state changes, so the displayed view gets `view.setState(next.state)`; for `withFormat` nothing is dispatched):
  ```ts
  const setEol = (eol: Eol) => updateActive((b) => withFormat(b, { eol }))
  const setEncoding = (encoding: EncodingName, bom: boolean) => updateActive((b) => withFormat(b, { encoding, bom }))
  const setLanguage = (languageId: string) => updateActive((b) => withLanguage(b, languageId, stateFor))
  const reinterpret = async (encoding: EncodingName) => {
    const b = activeBuffer(); if (!b?.meta) return
    if (isDirty(b)) { setState('status', 'reinterpret needs a clean buffer: save or revert first'); return }
    const result = await invoke('fs.open', { path: b.meta.path, encoding })
    R.tap(result, (file) => updateActive((cur) => replaceContents(cur, file, stateFor)))
  }
  const setIndent = (tabSize: number, insertSpaces: boolean) => updateActive((b) => ({ ...b, state: b.state.update({ effects: indentOverride.reconfigure([EditorState.tabSize.of(tabSize), indentUnit.of(insertSpaces ? ' '.repeat(tabSize) : '\t')]) }).state }))
  ```
  where `indentOverride` is a new `Compartment` included in `stateFor` as `indentOverride.of([])` **after** the settings compartment so it wins. For `setIndent` on a displayed buffer, dispatch the effect to the view instead of `state.update` (same pattern as `applySettings`).
- `BufferMeta` gains `tabSize: number` and `insertSpaces: boolean` (read from `state.facet(EditorState.tabSize)` / `state.facet(indentUnit)`) so the status bar is reactive.
- Restore `dirty` correctness: `metaOf` uses the new `isDirty`.

`registerCommands.ts` — add (with `when: 'hasBuffer'`):
```ts
{ id: 'buffer.setEol', title: 'Buffer: Set Line Endings', when: 'hasBuffer', run: (args) => ws.setEol(Eol.parse(args)) },
{ id: 'buffer.setEncoding', title: 'Buffer: Save with Encoding', when: 'hasBuffer', run: (args) => { const a = z.object({ encoding: EncodingName, bom: z.boolean() }).parse(args); ws.setEncoding(a.encoding, a.bom) } },
{ id: 'buffer.reinterpret', title: 'Buffer: Reinterpret as Encoding', when: 'hasBuffer', run: (args) => ws.reinterpret(EncodingName.parse(args)) },
{ id: 'buffer.setLanguage', title: 'Buffer: Set Syntax', when: 'hasBuffer', run: (args) => ws.setLanguage(z.string().parse(args)) },
{ id: 'buffer.setIndent', title: 'Buffer: Set Indentation', when: 'hasBuffer', run: (args) => { const a = z.object({ tabSize: z.number().int().min(1).max(16), insertSpaces: z.boolean() }).parse(args); ws.setIndent(a.tabSize, a.insertSpaces) } },
```
`whenContext` gains `hasBuffer: ws.activeBuffer() !== null`.

`Popup.tsx`:
```tsx
import { For, onCleanup, onMount } from 'solid-js'

export type PopupItem = { readonly label: string; readonly active?: boolean; readonly onSelect: () => void }

export const Popup = (props: { items: readonly PopupItem[]; onClose: () => void }) => {
  let root!: HTMLDivElement
  onMount(() => {
    const onDown = (e: MouseEvent) => { if (!root.contains(e.target as Node)) props.onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose() }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    onCleanup(() => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey, true) })
  })
  return (
    <div class="popup" ref={root} role="menu">
      <For each={props.items}>
        {(item) => (
          <div class="popup-item" data-testid="popup-item" classList={{ active: item.active ?? false }} role="menuitem" onClick={() => { item.onSelect(); props.onClose() }}>
            {item.label}
          </div>
        )}
      </For>
    </div>
  )
}
```

`StatusBar.tsx` — each of `encoding`, `eol`, `language`, `indent` is a `<button class="status-item" data-testid=...>` toggling `open()` ∈ `'encoding' | 'eol' | 'language' | 'indent' | null`; a `<Show when={open()}>` renders `<Popup>` positioned above the bar (`position: absolute; bottom: 100%`) inside a relatively positioned wrapper. Item lists:
- encoding: for each `encodingNames`: `Reinterpret as <label>` → `buffer.reinterpret`; separator-ish second group: `Save with <label>` (`utf8` once plain, once `UTF-8 BOM`) → `buffer.setEncoding`.
- eol: `LF` / `CRLF` / `CR` → `buffer.setEol`.
- language: every `languages` entry by name → `buffer.setLanguage`.
- indent: `Indent Using Spaces` / `Indent Using Tabs` / `Tab Width: 2|4|8` → `buffer.setIndent` combining with the current values. Label shows `Spaces: N` or `Tabs: N`.

`style.css` additions: `.statusbar { position: relative }`, `.status-item { background: none; border: none; color: inherit; font: inherit; cursor: pointer; padding: 0 4px }`, `.popup { position: absolute; bottom: 100%; left: 0; min-width: 220px; max-height: 50vh; overflow-y: auto; background: var(--bar); border: 1px solid var(--border); border-radius: 6px 6px 0 0; box-shadow: 0 -8px 24px rgba(0,0,0,.35); z-index: 50 }`, `.popup-item { padding: 5px 12px; cursor: default }`, `.popup-item:hover, .popup-item.active { background: var(--selection) }`.

Test hooks: `format: () => { const b = ws.activeBuffer(); return b ? b.format : null }`, `dirty: () => { const b = ws.activeBuffer(); return b ? isDirty(b) : false }`.

- [x] **Step 4: Run** — `pnpm typecheck && pnpm test && pnpm build && pnpm exec playwright test` → PASS. Existing `roundtrip.spec.ts` still passes because `format` starts equal to the file's detected format.

- [x] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "feat(statusbar): encoding, EOL, syntax and indent menus with pending save format tracked as dirty"
```

---

### Task 4: Banner for save conflicts, lossy encodings, read-only files

**Files:**
- Create: `src/renderer/src/ui/banner/Banner.tsx`
- Modify: `src/renderer/src/app/workspace.ts` (banner state + actions), `src/renderer/src/ui/layout/PaneView.tsx` (render banner above editor), `src/renderer/src/style.css`, `src/renderer/src/testHooks.ts`
- Test: `tests/e2e/banner.spec.ts`

**Interfaces:**
- `Banner = { kind: 'conflict'; diskHash: string } | { kind: 'encodingLossy'; positions: readonly number[] } | { kind: 'readonly' }`; workspace state `banners: Record<BufferId, Banner>`.
- Save errors set the banner for that buffer instead of a status message. Banner actions: conflict → `Overwrite` (`save('overwrite')`), `Reload from Disk` (`reload()` = re-open path and `replaceContents`), `Dismiss`; encodingLossy → `Save as UTF-8` (`setEncoding('utf8', false)` then `save()`), `Dismiss`; readonly → `Save As…`, `Dismiss`. Any successful save clears the buffer's banner.
- Test ids: `banner`, `banner-action` (with text).

- [x] **Step 1: Write the failing E2E**

`tests/e2e/banner.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import iconv from 'iconv-lite'
import { launchApp } from './launch'

const tempFile = (name: string, bytes: Buffer) => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-banner-'))
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return path
}

test('conflict banner offers overwrite and reload', async () => {
  const path = tempFile('c.txt', Buffer.from('v1\n'))
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('x')
  writeFileSync(path, 'v2 from agent\n')

  await page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await expect(page.getByTestId('banner')).toContainText('changed on disk')
  expect(readFileSync(path, 'utf8')).toBe('v2 from agent\n')

  await page.getByTestId('banner-action', { hasText: 'Reload from Disk' }).click()
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('v2 from agent\n')
  await expect(page.getByTestId('banner')).toHaveCount(0)
  expect(await page.evaluate(() => window.__moruTest!.dirty())).toBe(false)

  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('y')
  writeFileSync(path, 'v3\n')
  await page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await expect(page.getByTestId('banner')).toContainText('changed on disk')
  await page.getByTestId('banner-action', { hasText: 'Overwrite' }).click()
  await expect(page.getByTestId('banner')).toHaveCount(0)
  expect(readFileSync(path, 'utf8')).toBe('yv2 from agent\n')

  await app.close()
})

test('lossy encoding banner can switch to UTF-8 and save', async () => {
  const path = tempFile('k.txt', iconv.encode('가\n', 'cp949'))
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('😀')

  await page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await expect(page.getByTestId('banner')).toContainText('cannot represent')
  expect(Buffer.compare(readFileSync(path), iconv.encode('가\n', 'cp949'))).toBe(0)

  await page.getByTestId('banner-action', { hasText: 'Save as UTF-8' }).click()
  await expect(page.getByTestId('banner')).toHaveCount(0)
  await expect(page.getByTestId('encoding')).toHaveText('UTF-8')
  expect(readFileSync(path, 'utf8')).toBe('😀가\n')

  await app.close()
})
```

- [x] **Step 2: Run to verify failure** — FAIL (no banner).

- [x] **Step 3: Implement**

Workspace: add `banners: Record<BufferId, Banner>` to `WorkspaceState`; in `saveBuffer` error branch:
```ts
(error) => {
  if (error.kind === 'conflict') setState('banners', buffer.id, { kind: 'conflict', diskHash: error.diskHash })
  else if (error.kind === 'encodingLossy') setState('banners', buffer.id, { kind: 'encodingLossy', positions: error.positions })
  else if (error.kind === 'readonly') setState('banners', buffer.id, { kind: 'readonly' })
  else setState('status', describeSaveError(error))
  return false
}
```
Success branch: `setState(produce((s) => { delete s.banners[buffer.id] }))`. Add `dismissBanner(bufferId)`, `reload()` (re-open active path, `replaceContents`, clear banner), and `saveAsUtf8()` = `setEncoding('utf8', false)` then `save('normal')`. Also clear the banner in `dropTab`.

`Banner.tsx`:
```tsx
import { Show } from 'solid-js'
import type { Workspace } from '../../app/workspace'
import type { PaneLeaf } from '../layout/paneTree'

export const Banner = (props: { ws: Workspace; leaf: () => PaneLeaf }) => {
  const bufferId = () => {
    const tab = props.leaf().active ? props.ws.state.tabs[props.leaf().active!] : undefined
    return tab?.bufferId ?? null
  }
  const banner = () => (bufferId() ? props.ws.state.banners[bufferId()!] : undefined)
  const act = (f: () => void | Promise<void>) => () => { props.ws.focusPane(props.leaf().id); void f() }

  return (
    <Show when={banner()}>
      {(b) => (
        <div class="banner" data-testid="banner" classList={{ warning: b().kind !== 'readonly' }}>
          <span class="banner-text">
            {b().kind === 'conflict' && 'File changed on disk since it was opened.'}
            {b().kind === 'encodingLossy' && `Encoding cannot represent ${(b() as { positions: readonly number[] }).positions.length} character(s).`}
            {b().kind === 'readonly' && 'File is read-only.'}
          </span>
          <Show when={b().kind === 'conflict'}>
            <button data-testid="banner-action" onClick={act(() => props.ws.save('overwrite'))}>Overwrite</button>
            <button data-testid="banner-action" onClick={act(() => props.ws.reload())}>Reload from Disk</button>
          </Show>
          <Show when={b().kind === 'encodingLossy'}>
            <button data-testid="banner-action" onClick={act(() => props.ws.saveAsUtf8())}>Save as UTF-8</button>
          </Show>
          <Show when={b().kind === 'readonly'}>
            <button data-testid="banner-action" onClick={act(() => props.ws.saveAs())}>Save As…</button>
          </Show>
          <button data-testid="banner-action" onClick={act(() => props.ws.dismissBanner(bufferId()!))}>Dismiss</button>
        </div>
      )}
    </Show>
  )
}
```

`PaneView.tsx` `LeafView`: render `<Banner ws leaf />` between `TabStrip` and `EditorHost`.

`style.css`: `.banner { display: flex; gap: 8px; align-items: center; padding: 6px 10px; background: color-mix(in srgb, var(--bar) 70%, #e6c07b 30%); color: var(--fg); font-size: 12px } .banner .banner-text { flex: 1 } .banner button { font: inherit; padding: 2px 8px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); border-radius: 4px; cursor: pointer }`.

Test hook: none new (banner asserted via DOM).

- [x] **Step 4: Run** — `pnpm typecheck && pnpm build && pnpm exec playwright test tests/e2e/banner.spec.ts tests/e2e/roundtrip.spec.ts` → PASS. Update `roundtrip.spec.ts`'s conflict test: the status text assertion `toContainText('conflict')` becomes `await expect(page.getByTestId('banner')).toContainText('changed on disk')`.

- [x] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "feat(banner): per-buffer banner for disk conflicts, lossy encodings and read-only files"
```

---

### Task 5: Dirty store sync and crash recovery

**Files:**
- Create: `src/renderer/src/app/dirtySync.ts`
- Modify: `src/renderer/src/app/workspace.ts`, `src/renderer/src/App.tsx`
- Test: `tests/unit/renderer/dirtySync.test.ts`, `tests/e2e/recovery.spec.ts`

**Interfaces:**
- `createDirtySync(deps: { write(entry: DirtyEntry): Promise<unknown>; clear(id: string): Promise<unknown>; delayMs?: number; maxDelayMs?: number; now?: () => number; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout })` → `{ changed(buffer: { id; path; text; selection }, dirty: boolean): void; flush(): Promise<void>; dispose(): void }`. Debounce 1000 ms after the last change with a 5000 ms cap since the first unflushed change; `dirty === false` cancels the pending write and calls `clear(id)` if a previous write happened for that id.
- Workspace: calls `dirtySync.changed(...)` from `putBuffer` when the doc or dirty flag changed; `clear` on save/close; `restoreDirty()` on startup reads `dirty.list()` and, for each entry: with `path` → open the file, then replace the doc with the stored text (dirty), restore selection; without → `newUntitled()` with the text. Restore happens **before** startup paths are opened so a startup path that matches a restored buffer focuses it instead of opening twice.
- Main: `dirty.list` already exists; after successful restore the renderer calls `dirty.clear` for entries it adopted (they will be re-written on the next tick if still dirty).

- [x] **Step 1: Write failing tests**

`tests/unit/renderer/dirtySync.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createDirtySync } from '@renderer/app/dirtySync'

const setup = () => {
  vi.useFakeTimers()
  const write = vi.fn(async () => undefined)
  const clear = vi.fn(async () => undefined)
  const sync = createDirtySync({ write, clear })
  return { write, clear, sync }
}

const entry = (text: string) => ({ id: 'b1', path: '/a.ts', text, selection: { anchor: 0, head: 0 } })

describe('dirty sync', () => {
  it('writes once 1s after the last change', async () => {
    const { write, sync } = setup()
    sync.changed(entry('a'), true)
    await vi.advanceTimersByTimeAsync(500)
    sync.changed(entry('ab'), true)
    await vi.advanceTimersByTimeAsync(900)
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(entry('ab'))
    vi.useRealTimers()
  })

  it('caps the delay at 5s while typing continuously', async () => {
    const { write, sync } = setup()
    for (let i = 0; i < 12; i += 1) {
      sync.changed(entry('x'.repeat(i + 1)), true)
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]?.[0]).toMatchObject({ text: 'x'.repeat(10) })
    vi.useRealTimers()
  })

  it('a clean buffer cancels pending writes and clears a previously written entry', async () => {
    const { write, clear, sync } = setup()
    sync.changed(entry('a'), true)
    await vi.advanceTimersByTimeAsync(1100)
    expect(write).toHaveBeenCalledTimes(1)

    sync.changed(entry('ab'), true)
    sync.changed(entry('a'), false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(write).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledWith('b1')
    vi.useRealTimers()
  })

  it('clean without a prior write does nothing', async () => {
    const { clear, sync } = setup()
    sync.changed(entry('a'), false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(clear).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('flush writes pending entries immediately', async () => {
    const { write, sync } = setup()
    sync.changed(entry('a'), true)
    await sync.flush()
    expect(write).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
```

`tests/e2e/recovery.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

test('unsaved edits and untitled buffers survive SIGKILL', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-recovery-'))
  const path = join(dir, 'a.txt')
  writeFileSync(path, 'disk\n')

  const first = await launchApp({ MORU_TEST_OPEN: path })
  await first.page.evaluate(() => window.__moruTest!.focus())
  await first.page.evaluate(() => window.__moruTest!.setCursor(0))
  await first.page.keyboard.type('unsaved ')
  await first.page.evaluate(() => window.__moruTest!.runCommand('file.new'))
  await first.page.evaluate(() => window.__moruTest!.focus())
  await first.page.keyboard.type('scratch 한글')
  await first.page.waitForTimeout(1500)

  first.app.process().kill('SIGKILL')
  await first.app.waitForEvent('close')
  expect(readFileSync(path, 'utf8')).toBe('disk\n')

  const second = await launchApp({}, { userData: first.userData })
  await expect.poll(async () => (await second.page.evaluate(() => window.__moruTest!.tabs()))[0]?.tabs.map((t) => t.title)).toEqual(['a.txt', 'untitled'])

  await second.page.evaluate(() => window.__moruTest!.runCommand('tab.select', 1))
  await expect.poll(() => second.page.evaluate(() => window.__moruTest!.doc())).toBe('unsaved disk\n')
  expect(await second.page.evaluate(() => window.__moruTest!.dirty())).toBe(true)

  await second.page.evaluate(() => window.__moruTest!.runCommand('tab.select', 2))
  await expect.poll(() => second.page.evaluate(() => window.__moruTest!.doc())).toBe('scratch 한글')

  await second.app.close()
})

test('a restored file buffer is not opened twice when it is also a startup path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-recovery-'))
  const path = join(dir, 'a.txt')
  writeFileSync(path, 'disk\n')

  const first = await launchApp({ MORU_TEST_OPEN: path })
  await first.page.evaluate(() => window.__moruTest!.focus())
  await first.page.keyboard.type('x')
  await first.page.waitForTimeout(1500)
  first.app.process().kill('SIGKILL')
  await first.app.waitForEvent('close')

  const second = await launchApp({ MORU_TEST_OPEN: path }, { userData: first.userData })
  await expect.poll(async () => (await second.page.evaluate(() => window.__moruTest!.tabs()))[0]?.tabs.length).toBe(1)
  await expect.poll(() => second.page.evaluate(() => window.__moruTest!.doc())).toContain('x')
  await second.app.close()
})
```

- [x] **Step 2: Run to verify failure** — FAIL.

- [x] **Step 3: Implement**

`src/renderer/src/app/dirtySync.ts`:
```ts
import type { DirtyEntry } from '@shared/ipc'

type Deps = {
  readonly write: (entry: DirtyEntry) => Promise<unknown>
  readonly clear: (id: string) => Promise<unknown>
  readonly delayMs?: number
  readonly maxDelayMs?: number
}

export type DirtySync = {
  readonly changed: (entry: DirtyEntry, dirty: boolean) => void
  readonly flush: () => Promise<void>
  readonly dispose: () => void
}

type Pending = { readonly entry: DirtyEntry; readonly firstChangeAt: number; readonly timer: ReturnType<typeof setTimeout> }

export const createDirtySync = ({ write, clear, delayMs = 1000, maxDelayMs = 5000 }: Deps): DirtySync => {
  let pending: Record<string, Pending> = {}
  let written: Record<string, true> = {}

  const commit = async (id: string): Promise<void> => {
    const p = pending[id]
    if (!p) return
    clearTimeout(p.timer)
    const { [id]: _dropped, ...rest } = pending
    pending = rest
    written = { ...written, [id]: true }
    await write(p.entry)
  }

  const schedule = (entry: DirtyEntry): void => {
    const previous = pending[entry.id]
    if (previous) clearTimeout(previous.timer)

    const firstChangeAt = previous?.firstChangeAt ?? Date.now()
    const wait = Math.max(0, Math.min(delayMs, firstChangeAt + maxDelayMs - Date.now()))
    const timer = setTimeout(() => void commit(entry.id), wait)
    pending = { ...pending, [entry.id]: { entry, firstChangeAt, timer } }
  }

  const changed = (entry: DirtyEntry, dirty: boolean): void => {
    if (dirty) {
      schedule(entry)
      return
    }

    const p = pending[entry.id]
    if (p) {
      clearTimeout(p.timer)
      const { [entry.id]: _dropped, ...rest } = pending
      pending = rest
    }
    if (written[entry.id]) {
      const { [entry.id]: _w, ...restWritten } = written
      written = restWritten
      void clear(entry.id)
    }
  }

  const flush = async (): Promise<void> => {
    await Promise.all(Object.keys(pending).map(commit))
  }

  const dispose = (): void => {
    Object.values(pending).forEach((p) => clearTimeout(p.timer))
    pending = {}
  }

  return { changed, flush, dispose }
}
```

Workspace:
- `Deps` gains `dirtySync: DirtySync`.
- In `putBuffer`, after computing `next` meta: if the buffer's doc or dirty flag changed versus the previous stored buffer, call `deps.dirtySync.changed({ id: buffer.id, path: buffer.meta?.path ?? null, text: buffer.state.doc.toString(), selection: { anchor: buffer.state.selection.main.anchor, head: buffer.state.selection.main.head } }, next.dirty)`.
- `dropTab`: `deps.dirtySync.changed({ id, path, text: '', selection: {anchor:0, head:0} }, false)` to clear.
- New `restoreDirty(): Promise<void>`:
  ```ts
  const restoreDirty = async (): Promise<void> => {
    const listed = await invoke('dirty.list', undefined)
    const entries = R.getWithDefault(listed, [] as DirtyEntry[])
    for (const entry of entries) {
      if (entry.path) {
        const opened = await openFile(entry.path)
        const buffer = opened ? activeBuffer() : null
        if (buffer) replaceDocOfActive(entry.text, entry.selection)
        else newUntitledWith(entry.text, entry.selection)
      } else {
        newUntitledWith(entry.text, entry.selection)
      }
      await invoke('dirty.clear', entry.id)
    }
  }
  ```
  where `replaceDocOfActive(text, selection)` dispatches a single change replacing the whole doc + selection to the active view (so it lands in undo history and marks dirty) and `newUntitledWith` creates the untitled buffer then dispatches the text. Because `putBuffer` sees these as dirty, the sync re-writes them with fresh ids.
- Expose `restoreDirty` on `Workspace`.

`App.tsx`: create `dirtySync = createDirtySync({ write: (e) => invoke('dirty.write', e), clear: (id) => invoke('dirty.clear', id) })`, pass to workspace, and in bootstrap: `await ws.restoreDirty()` **before** opening `paths`; on `window` `beforeunload` call `void dirtySync.flush()`.

- [x] **Step 4: Run** — `pnpm typecheck && pnpm test && pnpm build && pnpm exec playwright test tests/e2e/recovery.spec.ts tests/e2e/tabs.spec.ts` → PASS. If `first.app.waitForEvent('close')` never resolves after SIGKILL, replace it with `await new Promise((r) => setTimeout(r, 500))`.

- [x] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "feat(recovery): debounced dirty store sync and startup restore of unsaved buffers"
```

---

### Task 6: User keymap.json overlay and conflict report

**Files:**
- Create: `src/shared/keymapFile.ts`, `src/main/config/keymapDefaults.ts`
- Modify: `src/main/config/service.ts` (generic JSONC file service), `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/main/ipc/handlers.ts`, `src/main/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/app/registerCommands.ts`, `tests/unit/shared/ipc.test.ts`
- Test: `tests/unit/shared/keymapFile.test.ts`, `tests/e2e/userKeymap.spec.ts`

**Interfaces:**
- `keymapFile.ts`: `UserBinding = z.object({ keys: z.string().min(1), command: z.string().min(1), when: z.string().optional(), args: z.unknown().optional() })`, `KeymapFile = z.array(UserBinding)`, `parseKeymapText(text): { ok: true; bindings: Binding[] } | { ok: false; message: string }` (JSONC, empty → `[]`), `KeymapSnapshot = { bindings: Binding[]; error: string | null }`.
- Main: `createJsonFileService<T>(userData, fileName, defaultText, parse: (text) => ParsedLike<T>, fallback: T, onChange)` generalizes the settings service; `settings.json` and `keymap.json` both use it. Contracts: `keymap.get` → `KeymapSnapshot`; push `keymap.changed`.
- Renderer: `bindings` becomes a signal: `compileBindings([...defaultBindings(platform), ...userBindings], platform)`; `installKeymap` already takes a getter. Command `keymap.showConflicts` sets the status to `N conflicts: <keys>…` or `no keymap conflicts` and logs details via `log.write`.

- [x] **Step 1: Write failing tests**

`tests/unit/shared/keymapFile.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseKeymapText } from '@shared/keymapFile'

describe('parseKeymapText', () => {
  it('parses an array of bindings with comments', () => {
    const r = parseKeymapText(`[
      // split with a spare key
      { "keys": "mod+shift+9", "command": "view.splitRight" },
      { "keys": "mod+k mod+u", "command": "tab.select", "args": 2, "when": "editorFocus" },
    ]`)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.bindings).toEqual([
      { keys: 'mod+shift+9', command: 'view.splitRight' },
      { keys: 'mod+k mod+u', command: 'tab.select', args: 2, when: 'editorFocus' },
    ])
  })

  it('treats empty text as no bindings', () => {
    expect(parseKeymapText('')).toEqual({ ok: true, bindings: [] })
  })

  it('reports schema and syntax errors', () => {
    expect(parseKeymapText('[{ "keys": "" }]').ok).toBe(false)
    expect(parseKeymapText('[ oops').ok).toBe(false)
    expect(parseKeymapText('{ "keys": "a", "command": "b" }').ok).toBe(false)
  })
})
```

Add to `tests/unit/shared/ipc.test.ts`:
```ts
  it('keymap.get and keymap.changed carry a snapshot', () => {
    const snap = { bindings: [{ keys: 'mod+1', command: 'tab.select', args: 1 }], error: null }
    expect(contracts['keymap.get'].response.safeParse({ ok: true, value: snap }).success).toBe(true)
    expect(pushContracts['keymap.changed'].safeParse(snap).success).toBe(true)
  })
```

`tests/e2e/userKeymap.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('keymap.json bindings overlay the defaults and hot-reload', async () => {
  const { app, page, userData } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs().length)).toBe(1)

  writeFileSync(join(userData, 'keymap.json'), JSON.stringify([
    { keys: 'mod+shift+9', command: 'view.splitRight' },
    { keys: 'mod+d', command: 'view.splitDown', when: 'editorFocus' },
  ]))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.bindingFor('view.splitRight')), { timeout: 10_000 }).toBe('mod+shift+9')

  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+Shift+9`)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs().length)).toBe(2)

  await page.evaluate(() => window.__moruTest!.runCommand('view.focusPane', 1))
  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+d`)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs().length)).toBe(3)

  await page.evaluate(() => window.__moruTest!.runCommand('keymap.showConflicts'))
  await expect(page.getByTestId('status')).toContainText('no keymap conflicts')
  await app.close()
})

test('a conflicting user binding is reported', async () => {
  const { app, page, userData } = await launchApp({ MORU_TEST_OPEN: fixture })
  writeFileSync(join(userData, 'keymap.json'), JSON.stringify([
    { keys: 'mod+shift+7', command: 'view.splitRight' },
    { keys: 'mod+shift+7', command: 'view.splitDown' },
  ]))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.bindingFor('view.splitDown')), { timeout: 10_000 }).toBe('mod+shift+7')

  await page.evaluate(() => window.__moruTest!.runCommand('keymap.showConflicts'))
  await expect(page.getByTestId('status')).toContainText('1 keymap conflict')
  await app.close()
})
```

Test hook: `bindingFor(commandId): string | null` (last binding's `keys`).

- [x] **Step 2: Run to verify failure** — FAIL.

- [x] **Step 3: Implement**

`src/shared/keymapFile.ts`:
```ts
import { parse, type ParseError, printParseErrorCode } from 'jsonc-parser'
import { z } from 'zod'

export const UserBinding = z.object({
  keys: z.string().min(1),
  command: z.string().min(1),
  when: z.string().optional(),
  args: z.unknown().optional(),
})
export type UserBinding = z.infer<typeof UserBinding>

export const KeymapFile = z.array(UserBinding)

export const KeymapSnapshot = z.object({ bindings: KeymapFile, error: z.string().nullable() })
export type KeymapSnapshot = z.infer<typeof KeymapSnapshot>

export type ParsedKeymap = { ok: true; bindings: UserBinding[] } | { ok: false; message: string }

export const parseKeymapText = (text: string): ParsedKeymap => {
  if (text.trim() === '') return { ok: true, bindings: [] }

  const errors: ParseError[] = []
  const data: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    return { ok: false, message: errors.map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`).join('; ') }
  }

  const parsed = KeymapFile.safeParse(data)
  return parsed.success
    ? { ok: true, bindings: parsed.data }
    : { ok: false, message: parsed.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ') }
}
```

`src/main/config/keymapDefaults.ts`:
```ts
export const defaultKeymapText = `[
  // User key bindings overlay the built-in Sublime-style defaults.
  // { "keys": "mod+shift+9", "command": "view.splitRight" },
  // { "keys": "mod+k mod+u", "command": "tab.select", "args": 2, "when": "editorFocus" }
]
`
```

`src/main/config/service.ts` — generalize:
```ts
export type Snapshot<T> = { readonly value: T; readonly error: string | null }
export type FileService<T> = { readonly snapshot: () => Snapshot<T>; readonly dispose: () => void }

export const createJsonFileService = async <T>(
  userData: string,
  fileName: string,
  defaultText: string,
  parseText: (text: string) => { ok: true; value: T } | { ok: false; message: string },
  fallback: T,
  onChange: (snapshot: Snapshot<T>) => void,
): Promise<FileService<T>> => { /* same body as before, parameterized */ }

export const createConfigService = (userData, onChange) =>
  createJsonFileService(userData, 'settings.json', defaultFileText,
    (t) => { const p = parseSettingsText(t); return p.ok ? { ok: true, value: p.settings } : p }, defaultSettings,
    (s) => onChange({ settings: s.value, error: s.error }))
export const createKeymapService = (userData, onChange) =>
  createJsonFileService(userData, 'keymap.json', defaultKeymapText,
    (t) => { const p = parseKeymapText(t); return p.ok ? { ok: true, value: p.bindings } : p }, [] as UserBinding[],
    (s) => onChange({ bindings: s.value, error: s.error }))
```
Keep `ConfigService = { snapshot(): ConfigSnapshot; dispose() }` by mapping the snapshot in `createConfigService` (wrap the returned service). Because both services `fs.watch` the same directory, each one filters on its own file name.

Channels/contracts: `keymapGet: 'keymap.get'`, `keymapChanged: 'keymap.changed'` (push). `'keymap.get': { request: z.undefined(), response: ipcResult(KeymapSnapshot, UnexpectedError) }`, `pushContracts['keymap.changed'] = KeymapSnapshot`. Handler: `handle('keymap.get', async () => ok(keymap.snapshot()))` with `HandlerDeps.keymap`. `index.ts`: create the keymap service pushing `keymap.changed`.

Renderer `App.tsx`:
```ts
const [userBindings, setUserBindings] = createSignal<readonly Binding[]>([])
const bindings = createMemo(() => compileBindings([...defaultBindings(platform()), ...userBindings()], platform()))
// bootstrap: const km = await invoke('keymap.get', undefined); R.tap(km, (s) => setUserBindings(s.bindings)); onCleanup(on('keymap.changed', (s) => setUserBindings(s.bindings)))
// installKeymap(window, bindings, registry, context); <CommandPalette bindings={bindings()} …/> → make PaletteProps.bindings an Accessor
```
`registerCommands.ts` gains `keymap.showConflicts`:
```ts
{ id: 'keymap.showConflicts', title: 'Keymap: Show Conflicts', run: () => {
  const conflicts = findConflicts(ui.bindings())
  ws.setStatus(conflicts.length === 0 ? 'no keymap conflicts' : `${conflicts.length} keymap conflict(s): ${conflicts.map((c) => c.keys).join(', ')}`)
  window.moru.send('log.write', { level: 'warn', message: 'keymap conflicts', meta: conflicts })
} }
```
(`Ui` gains `bindings: () => readonly CompiledBinding[]`.)

Test hook `bindingFor(commandId)`: `[...bindings()].reverse().find((b) => b.command === commandId)?.keys ?? null` — pass `bindings` into `installTestHooks`.

- [x] **Step 4: Run** — `pnpm typecheck && pnpm test && pnpm build && pnpm exec playwright test` → all PASS.

- [x] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "feat(keymap): user keymap.json overlay with hot reload and conflict report"
```

---

### Task 7: Report

- [ ] Run `pnpm check`; write `docs/superpowers/reports/m1c-settings-and-recovery.md` with the same table format as M1b (areas: settings hot reload · theme · status menus · banner · dirty sync/recovery · user keymap · regressions), findings, decisions, and the M1 acceptance statement ("이 레포를 이걸로 편집" — note whether the author has started using it). Tick this plan's checkboxes. Commit `docs(m1c): add settings and recovery report`.

## Self-Review Notes

- Spec coverage: §5.6 설정 파일 → 에디터 반영·핫리로드 (T1), 테마 (T2), 키맵 사용자 파일 + 충돌 보고 (T6); §5.1 상태바 재해석/인코딩 저장 메뉴 (T3); §6.1 배너 3종 (T4); §4.3 dirty store 디바운스 + §8 M1 크래시 복원 (T5). Status-bar EOL 변경이 dirty로 잡히는 것은 §4.4 "mixedEol → 다수결" 규칙과 충돌하지 않음 (사용자가 명시적으로 고른 값이 우선).
- Type consistency: `Format`/`Saved` (T3) used by T4 `saveAsUtf8`/`reload`; `DirtyEntry` from `@shared/ipc` used by T5; `Binding`/`CompiledBinding` (M1b) used by T6; `PaletteProps.bindings` changes to an accessor in T6 — update `CommandPalette` reads to `props.bindings()`.
- Test-id contract additions: `indent`, `popup-item`, `banner`, `banner-action`. Hooks: `editorSettings`, `format`, `dirty`, `bindingFor`.
