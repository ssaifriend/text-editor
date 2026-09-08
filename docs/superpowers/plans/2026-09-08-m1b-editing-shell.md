# M1b Editing Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-editor prototype into a Sublime-shaped shell: many buffers, tab groups in a splittable pane tree, a command registry with `when` contexts, an ST3 default keymap, a command palette, a native menu that dispatches commands, untitled buffers, and close-tab confirmation — all keyboard-driven and covered by E2E.

**Architecture:** Renderer state splits into a non-reactive buffer registry (one immutable CM6 `EditorState` per buffer, `dirty = !doc.eq(savedDoc)`) and a Solid store for what the UI shows (pane tree, tabs, buffer metadata). Each pane leaf owns one `EditorView`; switching tabs swaps `EditorState`s, so undo history travels with the buffer. All user actions are commands in one registry; the keymap, the palette, and the native menu only reference command ids. A window-level capture keydown handler resolves chords against compiled bindings filtered by `when` before CodeMirror sees the key.

**Tech Stack:** Solid.js 1.9 (`createStore`), CodeMirror 6 (`@codemirror/commands`, `@codemirror/search`, `@codemirror/language` `StreamLanguage`, language packages python/rust/go/html/css/yaml/sql, `@codemirror/legacy-modes` shell), `fzf` 0.5.2 for the palette, Electron `Menu`, `dialog.showMessageBox`.

**Spec:** `docs/superpowers/specs/2026-09-08-text-editor-design.md` — §3.4 (renderer 모듈), §3.5 (pane 모델), §3.6 (커맨드/`when`), §5.2 멀티커서 커맨드 표, §5.6 키맵, §8 M1.

## Global Constraints

- Pane = tab group; `Tab = { id, kind: 'buffer', bufferId }` so M2 can add `preview`/`terminal`/`search` kinds without changing the tree.
- A buffer is shown in at most one pane at a time (moving a tab moves it). One `EditorView` per pane leaf; buffers hold `EditorState`.
- Every user-facing action is a registered command `{ id, title, when?, run }`. Keymap, palette, menu reference ids only.
- Key strokes are matched by `event.code` for letters/digits/punctuation (layout-independent) and by `event.key` for named keys. `mod` = `meta` on macOS, `ctrl` elsewhere.
- Editor commands (`when: 'editorFocus'`) run against the focused pane's `EditorView`.
- The window keydown handler runs in the capture phase and `preventDefault`s only when a binding runs or a chord prefix is pending.
- Closing a dirty tab asks via native `dialog.showMessageBox`; in test mode (`MORU_TEST=1`) the answer comes from `MORU_TEST_CONFIRM` (`save` | `dontSave` | `cancel`, default `dontSave`).
- Existing E2E (IME, round-trip, file, log, perf, pty, smoke) must keep passing; where they used the toolbar buttons they switch to `window.__moruTest.runCommand('file.save')`.
- TS strict, ts-belt, functional style. Conventional commits after each task.

## File Structure

```
src/shared/channels.ts                 # (modify) + command.run push, dialog.confirmClose invoke
src/shared/ipc.ts                      # (modify) contracts for the above
src/main/menu.ts                       # application menu → pushToAll('command.run')
src/main/ipc/handlers.ts               # (modify) dialog.confirmClose
src/main/index.ts                      # (modify) install menu

src/renderer/src/editor/lang.ts        # (rewrite) Language registry: id/name/load, ext+filename map, legacy shell
src/renderer/src/editor/buffers.ts     # Buffer type + pure ops (createBuffer, isDirty, markSaved, titleOf)
src/renderer/src/editor/createEditor.ts# (modify) baseExtensions(languageExt) + createView(parent, onUpdate, onFocus)
src/renderer/src/editor/commands.ts    # CM6 command wrappers table (id → title → Command)
src/renderer/src/commands/when.ts      # when-expression parser/evaluator
src/renderer/src/commands/registry.ts  # command registry
src/renderer/src/keymap/keys.ts        # parseKeys, strokeFromEvent, formatKeys
src/renderer/src/keymap/bindings.ts    # compile, resolve (chords), findConflicts
src/renderer/src/keymap/defaults.ts    # ST3 default bindings (mac/win)
src/renderer/src/ui/layout/paneTree.ts # pure pane tree ops
src/renderer/src/app/workspace.ts      # Solid store + buffer registry + actions (open/new/close/split/save)
src/renderer/src/ui/layout/PaneView.tsx
src/renderer/src/ui/layout/SplitGutter.tsx
src/renderer/src/ui/tabs/TabStrip.tsx
src/renderer/src/ui/editor/EditorHost.tsx
src/renderer/src/ui/palette/CommandPalette.tsx
src/renderer/src/ui/statusbar/StatusBar.tsx
src/renderer/src/App.tsx               # (rewrite) composition only
src/renderer/src/testHooks.ts          # (rewrite)
src/renderer/src/style.css             # (modify)

tests/unit/renderer/lang.test.ts       # (rewrite)
tests/unit/renderer/buffers.test.ts
tests/unit/renderer/paneTree.test.ts
tests/unit/renderer/when.test.ts
tests/unit/renderer/registry.test.ts
tests/unit/renderer/keys.test.ts
tests/unit/renderer/bindings.test.ts
tests/e2e/types.d.ts                   # (modify)
tests/e2e/tabs.spec.ts
tests/e2e/split.spec.ts
tests/e2e/palette.spec.ts
tests/e2e/keymap.spec.ts
tests/e2e/close.spec.ts
tests/e2e/menu.spec.ts
tests/e2e/file.spec.ts, roundtrip.spec.ts  # (modify) use runCommand('file.save')
docs/superpowers/reports/m1b-editing-shell.md
```

---

### Task 1: Language registry (core languages + legacy shell fallback)

**Files:**
- Rewrite: `src/renderer/src/editor/lang.ts`
- Rewrite: `tests/unit/renderer/lang.test.ts`

**Interfaces:**
- `Language = { readonly id: string; readonly name: string; readonly load: () => Extension }`
- `plainLanguage: Language` (`id: 'plain'`, `name: 'Plain Text'`, `load: () => []`)
- `languages: readonly Language[]` (all known, plain first)
- `languageFor(path: string): Language`, `languageById(id: string): Language` (falls back to plain), `extensionOf(path: string): string` (kept from M0), `basenameOf(path: string): string`.

- [x] **Step 1: Write the failing tests**

`tests/unit/renderer/lang.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { basenameOf, extensionOf, languageById, languageFor, languages, plainLanguage } from '@renderer/editor/lang'

describe('extensionOf / basenameOf', () => {
  it('extracts lowercase extension and basename for posix and windows paths', () => {
    expect(extensionOf('/a/b/File.TS')).toBe('ts')
    expect(extensionOf('C:\\work\\notes.MD')).toBe('md')
    expect(basenameOf('/a/b/File.TS')).toBe('File.TS')
    expect(basenameOf('C:\\work\\notes.MD')).toBe('notes.MD')
    expect(extensionOf('Makefile')).toBe('makefile')
  })
})

describe('languageFor', () => {
  it.each([
    ['a.ts', 'typescript'],
    ['a.tsx', 'tsx'],
    ['a.js', 'javascript'],
    ['a.mjs', 'javascript'],
    ['a.jsx', 'jsx'],
    ['a.json', 'json'],
    ['a.md', 'markdown'],
    ['a.py', 'python'],
    ['a.rs', 'rust'],
    ['a.go', 'go'],
    ['a.html', 'html'],
    ['a.css', 'css'],
    ['a.yml', 'yaml'],
    ['a.yaml', 'yaml'],
    ['a.sql', 'sql'],
    ['a.sh', 'shell'],
    ['a.zsh', 'shell'],
    ['a.bash', 'shell'],
    ['.zshrc', 'shell'],
    ['a.unknownext', 'plain'],
    ['LICENSE', 'plain'],
  ])('%s → %s', (path, id) => {
    expect(languageFor(path).id).toBe(id)
  })

  it('every non-plain language loads a non-empty extension', () => {
    for (const lang of languages.filter((l) => l.id !== 'plain')) {
      const ext = lang.load()
      expect(Array.isArray(ext) && ext.length === 0).toBe(false)
    }
  })
})

describe('languageById', () => {
  it('returns the language or plain', () => {
    expect(languageById('python').name).toBe('Python')
    expect(languageById('nope')).toBe(plainLanguage)
  })
})
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/renderer/lang.test.ts`
Expected: FAIL (`languages`, `languageById`, `basenameOf`, `plainLanguage` missing; `.py` → not `python`).

- [x] **Step 3: Implement**

`src/renderer/src/editor/lang.ts`:
```ts
import { css } from '@codemirror/lang-css'
import { go } from '@codemirror/lang-go'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import type { Extension } from '@codemirror/state'
import { A, D, O, S, pipe } from '@mobily/ts-belt'

export type Language = { readonly id: string; readonly name: string; readonly load: () => Extension }

export const plainLanguage: Language = { id: 'plain', name: 'Plain Text', load: () => [] }

export const languages: readonly Language[] = [
  plainLanguage,
  { id: 'typescript', name: 'TypeScript', load: () => javascript({ typescript: true }) },
  { id: 'tsx', name: 'TSX', load: () => javascript({ typescript: true, jsx: true }) },
  { id: 'javascript', name: 'JavaScript', load: () => javascript() },
  { id: 'jsx', name: 'JSX', load: () => javascript({ jsx: true }) },
  { id: 'json', name: 'JSON', load: () => json() },
  { id: 'markdown', name: 'Markdown', load: () => markdown() },
  { id: 'python', name: 'Python', load: () => python() },
  { id: 'rust', name: 'Rust', load: () => rust() },
  { id: 'go', name: 'Go', load: () => go() },
  { id: 'html', name: 'HTML', load: () => html() },
  { id: 'css', name: 'CSS', load: () => css() },
  { id: 'yaml', name: 'YAML', load: () => yaml() },
  { id: 'sql', name: 'SQL', load: () => sql() },
  { id: 'shell', name: 'Shell', load: () => StreamLanguage.define(shell) },
]

const byExtension: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  html: 'html',
  htm: 'html',
  css: 'css',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
}

const byFilename: Record<string, string> = {
  '.zshrc': 'shell',
  '.bashrc': 'shell',
  '.bash_profile': 'shell',
  '.profile': 'shell',
}

const lastSegment = (separator: string | RegExp) => (text: string): string =>
  pipe(text, (t) => t.split(separator), A.last, O.getWithDefault<string>(''))

export const basenameOf = (path: string): string => pipe(path, lastSegment(/[\\/]/))

export const extensionOf = (path: string): string => pipe(path, basenameOf, lastSegment('.'), S.toLowerCase)

const languageIdFor = (path: string): string => {
  const name = basenameOf(path).toLowerCase()
  return pipe(
    D.get(byFilename, name),
    O.match(
      (id) => id,
      () => pipe(D.get(byExtension, extensionOf(path)), O.getWithDefault('plain')),
    ),
  )
}

export const languageById = (id: string): Language =>
  pipe(
    languages,
    A.find((l) => l.id === id),
    O.getWithDefault(plainLanguage),
  )

export const languageFor = (path: string): Language => languageById(languageIdFor(path))
```

- [x] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run tests/unit/renderer/lang.test.ts && pnpm typecheck`
Expected: PASS. `App.tsx` still calls `languageFor(path)` and passes it where an `Extension` is expected — change that call to `languageFor(rest.path).load()` to keep typecheck green (App is rewritten in Task 6 anyway).

- [x] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/renderer/src/editor/lang.ts src/renderer/src/App.tsx tests/unit/renderer/lang.test.ts
git commit -m "feat(lang): language registry with core languages, filename map, and legacy shell mode"
```

---

### Task 2: Buffer model and editor factory refactor

**Files:**
- Create: `src/renderer/src/editor/buffers.ts`
- Modify: `src/renderer/src/editor/createEditor.ts`
- Test: `tests/unit/renderer/buffers.test.ts`

**Interfaces:**
- `BufferId = string`, `FileMeta = Omit<OpenedFile, 'text'>`
- `Buffer = { readonly id: BufferId; readonly meta: FileMeta | null; readonly languageId: string; readonly state: EditorState; readonly savedDoc: Text }`
- `createBuffer(id, file: OpenedFile | null, makeState: (doc: string, languageId: string) => EditorState): Buffer` — `file === null` → untitled, plain, empty doc; savedDoc = initial doc (untitled is not dirty until edited).
- `isDirty(b): boolean`, `titleOf(b): string` (basename or `untitled`), `withState(b, state): Buffer`, `markSaved(b, meta: FileMeta): Buffer` (savedDoc = current doc), `withLanguage(b, languageId, makeState): Buffer` (rebuilds state keeping doc and selection).
- `createEditor.ts` now exports `baseExtensions(language: Extension, onUpdate, onFocusChange): Extension`, `makeState(doc: string, language: Extension, extras: Extension): EditorState`, and `createView(parent: HTMLElement, state: EditorState): EditorView`. `Editor`/`createEditor` from M0 are removed (Task 6 rewires the app).

- [x] **Step 1: Write the failing tests**

`tests/unit/renderer/buffers.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { createBuffer, isDirty, markSaved, titleOf, withLanguage, withState } from '@renderer/editor/buffers'

const makeState = (doc: string) => EditorState.create({ doc })

const opened = {
  path: '/p/a.ts', text: 'hello', encoding: 'utf8' as const, bom: false, eol: 'lf' as const, mixedEol: false,
  confidence: 'high' as const, hash: 'h1', mtimeMs: 1, readonly: false, largeFile: false,
}

describe('buffers', () => {
  it('creates a clean buffer from an opened file', () => {
    const b = createBuffer('b1', opened, makeState)
    expect(b.meta?.path).toBe('/p/a.ts')
    expect(b.languageId).toBe('typescript')
    expect(b.state.doc.toString()).toBe('hello')
    expect(isDirty(b)).toBe(false)
    expect(titleOf(b)).toBe('a.ts')
  })

  it('creates an empty untitled buffer', () => {
    const b = createBuffer('b2', null, makeState)
    expect(b.meta).toBeNull()
    expect(b.languageId).toBe('plain')
    expect(isDirty(b)).toBe(false)
    expect(titleOf(b)).toBe('untitled')
  })

  it('becomes dirty when the doc changes and clean again when it matches savedDoc', () => {
    const b = createBuffer('b1', opened, makeState)
    const edited = withState(b, b.state.update({ changes: { from: 5, insert: '!' } }).state)
    expect(isDirty(edited)).toBe(true)

    const reverted = withState(edited, edited.state.update({ changes: { from: 5, to: 6 } }).state)
    expect(isDirty(reverted)).toBe(false)
  })

  it('markSaved adopts the current doc and new meta', () => {
    const b = createBuffer('b1', opened, makeState)
    const edited = withState(b, b.state.update({ changes: { from: 5, insert: '!' } }).state)
    const saved = markSaved(edited, { ...opened, hash: 'h2' })
    expect(isDirty(saved)).toBe(false)
    expect(saved.meta?.hash).toBe('h2')
  })

  it('withLanguage rebuilds the state but keeps doc and selection', () => {
    const b = createBuffer('b1', opened, makeState)
    const moved = withState(b, b.state.update({ selection: { anchor: 3 } }).state)
    const relanged = withLanguage(moved, 'python', makeState)
    expect(relanged.languageId).toBe('python')
    expect(relanged.state.doc.toString()).toBe('hello')
    expect(relanged.state.selection.main.head).toBe(3)
    expect(isDirty(relanged)).toBe(false)
  })
})
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/renderer/buffers.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

`src/renderer/src/editor/buffers.ts`:
```ts
import { EditorSelection, type EditorState, type Text } from '@codemirror/state'
import type { OpenedFile } from '@shared/ipc'
import { basenameOf, languageFor } from './lang'

export type BufferId = string
export type FileMeta = Omit<OpenedFile, 'text'>
export type MakeState = (doc: string, languageId: string) => EditorState

export type Buffer = {
  readonly id: BufferId
  readonly meta: FileMeta | null
  readonly languageId: string
  readonly state: EditorState
  readonly savedDoc: Text
}

export const createBuffer = (id: BufferId, file: OpenedFile | null, makeState: MakeState): Buffer => {
  const languageId = file ? languageFor(file.path).id : 'plain'
  const state = makeState(file?.text ?? '', languageId)
  const meta = file ? stripText(file) : null

  return { id, meta, languageId, state, savedDoc: state.doc }
}

const stripText = ({ text: _text, ...meta }: OpenedFile): FileMeta => meta

export const isDirty = (buffer: Buffer): boolean => !buffer.state.doc.eq(buffer.savedDoc)

export const titleOf = (buffer: Buffer): string => (buffer.meta ? basenameOf(buffer.meta.path) : 'untitled')

export const withState = (buffer: Buffer, state: EditorState): Buffer => ({ ...buffer, state })

export const markSaved = (buffer: Buffer, meta: FileMeta): Buffer => ({ ...buffer, meta, savedDoc: buffer.state.doc })

export const withLanguage = (buffer: Buffer, languageId: string, makeState: MakeState): Buffer => {
  const fresh = makeState(buffer.state.doc.toString(), languageId)
  const ranges = buffer.state.selection.ranges.map((r) => EditorSelection.range(r.anchor, r.head))
  const state = fresh.update({ selection: EditorSelection.create(ranges, buffer.state.selection.mainIndex) }).state

  return { ...buffer, languageId, state }
}
```

`src/renderer/src/editor/createEditor.ts` (full replacement):
```ts
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { compositionObserver } from './compositionObserver'

export type ViewHooks = {
  readonly onUpdate: (state: EditorState) => void
  readonly onFocusChange: (focused: boolean) => void
}

export const baseExtensions = (language: Extension, hooks: ViewHooks): Extension => [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  history(),
  drawSelection(),
  EditorState.allowMultipleSelections.of(true),
  rectangularSelection(),
  crosshairCursor(),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  highlightSelectionMatches(),
  keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
  compositionObserver,
  language,
  EditorView.updateListener.of((update) => {
    if (update.docChanged || update.selectionSet || update.focusChanged) hooks.onUpdate(update.state)
    if (update.focusChanged) hooks.onFocusChange(update.view.hasFocus)
  }),
]

export const makeState = (doc: string, extensions: Extension): EditorState => EditorState.create({ doc, extensions })

export const createView = (parent: HTMLElement, state: EditorState): EditorView => new EditorView({ state, parent })
```

Note: `hooks.onUpdate` is called for doc/selection/focus changes only, not for every viewport update — the status bar and dirty tracking do not need more.

- [x] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run tests/unit/renderer && pnpm typecheck`
Expected: buffers PASS. Typecheck FAILS in `App.tsx`/`testHooks.ts` (they import the removed `createEditor`/`Editor`). That is expected until Task 6; to keep the tree building, temporarily add to `createEditor.ts`:
```ts
export type Editor = { readonly view: EditorView; readonly setDoc: (text: string, language: Extension) => void; readonly setWhitespace: (on: boolean) => void }
```
and keep the M0 `createEditor` function body below the new exports (it will be deleted in Task 6). Re-run typecheck → PASS.

- [x] **Step 5: Commit**

```bash
git add src/renderer/src/editor tests/unit/renderer/buffers.test.ts
git commit -m "feat(editor): immutable buffer model with dirty tracking and reusable base extensions"
```

---

### Task 3: Pane tree pure operations

**Files:**
- Create: `src/renderer/src/ui/layout/paneTree.ts`
- Test: `tests/unit/renderer/paneTree.test.ts`

**Interfaces:**
```ts
type PaneId = string; type TabId = string
type PaneLeaf = { kind: 'leaf'; id: PaneId; tabs: readonly TabId[]; active: TabId | null }
type PaneSplit = { kind: 'split'; id: PaneId; direction: 'row' | 'col'; children: readonly PaneNode[]; sizes: readonly number[] }
type PaneNode = PaneLeaf | PaneSplit
createLeaf(id): PaneLeaf
leaves(tree): PaneLeaf[]
findLeaf(tree, paneId): PaneLeaf | null
leafOfTab(tree, tabId): PaneLeaf | null
addTab(tree, paneId, tabId, index?): PaneNode        // also activates it
removeTab(tree, tabId): PaneNode                      // activates right neighbor, else left, else null
setActiveTab(tree, paneId, tabId): PaneNode
moveTab(tree, tabId, toPaneId, index): PaneNode       // activates in destination
splitLeaf(tree, paneId, direction, newLeafId): PaneNode // sibling insert when parent has same direction
closeLeaf(tree, paneId): PaneNode                      // collapses single-child splits; last leaf stays
resizeSplit(tree, splitId, sizes): PaneNode
siblingLeaf(tree, paneId, delta: 1 | -1): PaneLeaf     // cyclic in leaves() order
```

- [x] **Step 1: Write the failing tests**

`tests/unit/renderer/paneTree.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  addTab, closeLeaf, createLeaf, findLeaf, leafOfTab, leaves, moveTab, removeTab, resizeSplit,
  setActiveTab, siblingLeaf, splitLeaf, type PaneNode,
} from '@renderer/ui/layout/paneTree'

const single = (): PaneNode => addTab(addTab(createLeaf('p1'), 'p1', 't1'), 'p1', 't2')

describe('tabs in a leaf', () => {
  it('addTab appends and activates', () => {
    const tree = single()
    expect(findLeaf(tree, 'p1')).toEqual({ kind: 'leaf', id: 'p1', tabs: ['t1', 't2'], active: 't2' })
  })

  it('addTab at an index inserts there', () => {
    const tree = addTab(single(), 'p1', 't0', 0)
    expect(findLeaf(tree, 'p1')?.tabs).toEqual(['t0', 't1', 't2'])
  })

  it('setActiveTab switches', () => {
    expect(findLeaf(setActiveTab(single(), 'p1', 't1'), 'p1')?.active).toBe('t1')
  })

  it('removeTab activates the right neighbor, then left, then null', () => {
    const tree = addTab(single(), 'p1', 't3')
    const a = removeTab(setActiveTab(tree, 'p1', 't2'), 't2')
    expect(findLeaf(a, 'p1')).toEqual({ kind: 'leaf', id: 'p1', tabs: ['t1', 't3'], active: 't3' })
    const b = removeTab(a, 't3')
    expect(findLeaf(b, 'p1')?.active).toBe('t1')
    const c = removeTab(b, 't1')
    expect(findLeaf(c, 'p1')).toEqual({ kind: 'leaf', id: 'p1', tabs: [], active: null })
  })

  it('removing an inactive tab keeps the active one', () => {
    const tree = removeTab(single(), 't1')
    expect(findLeaf(tree, 'p1')?.active).toBe('t2')
  })
})

describe('split / close', () => {
  it('splitLeaf replaces the leaf with a split holding it and the new empty leaf', () => {
    const tree = splitLeaf(single(), 'p1', 'row', 'p2')
    expect(tree.kind).toBe('split')
    if (tree.kind !== 'split') return
    expect(tree.direction).toBe('row')
    expect(tree.children.map((c) => c.id)).toEqual(['p1', 'p2'])
    expect(tree.sizes).toEqual([0.5, 0.5])
    expect(findLeaf(tree, 'p2')).toEqual({ kind: 'leaf', id: 'p2', tabs: [], active: null })
    expect(leaves(tree).map((l) => l.id)).toEqual(['p1', 'p2'])
  })

  it('splitting in the same direction inserts a sibling instead of nesting', () => {
    const tree = splitLeaf(splitLeaf(single(), 'p1', 'row', 'p2'), 'p2', 'row', 'p3')
    if (tree.kind !== 'split') throw new Error('expected split')
    expect(tree.children.map((c) => c.id)).toEqual(['p1', 'p2', 'p3'])
    expect(tree.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })

  it('splitting in the other direction nests', () => {
    const tree = splitLeaf(splitLeaf(single(), 'p1', 'row', 'p2'), 'p2', 'col', 'p3')
    if (tree.kind !== 'split') throw new Error('expected split')
    expect(tree.children[1]?.kind).toBe('split')
    expect(leaves(tree).map((l) => l.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('closeLeaf removes the leaf and collapses a single-child split', () => {
    const tree = closeLeaf(splitLeaf(single(), 'p1', 'row', 'p2'), 'p2')
    expect(tree).toEqual(single())
  })

  it('closeLeaf on the last leaf is a no-op', () => {
    const tree = single()
    expect(closeLeaf(tree, 'p1')).toBe(tree)
  })

  it('closeLeaf keeps remaining sizes normalized', () => {
    const three = splitLeaf(splitLeaf(single(), 'p1', 'row', 'p2'), 'p2', 'row', 'p3')
    const tree = closeLeaf(three, 'p1')
    if (tree.kind !== 'split') throw new Error('expected split')
    expect(tree.children.map((c) => c.id)).toEqual(['p2', 'p3'])
    expect(tree.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })

  it('resizeSplit replaces sizes', () => {
    const tree = resizeSplit(splitLeaf(single(), 'p1', 'row', 'p2'), 'root', [0.3, 0.7])
    if (tree.kind !== 'split') throw new Error('expected split')
    expect(tree.sizes).toEqual([0.3, 0.7])
  })
})

describe('moveTab / lookup / sibling', () => {
  it('moveTab moves and activates in the destination and fixes the source active tab', () => {
    const tree = moveTab(splitLeaf(single(), 'p1', 'row', 'p2'), 't2', 'p2', 0)
    expect(findLeaf(tree, 'p1')).toEqual({ kind: 'leaf', id: 'p1', tabs: ['t1'], active: 't1' })
    expect(findLeaf(tree, 'p2')).toEqual({ kind: 'leaf', id: 'p2', tabs: ['t2'], active: 't2' })
    expect(leafOfTab(tree, 't2')?.id).toBe('p2')
  })

  it('siblingLeaf cycles through leaves', () => {
    const tree = splitLeaf(splitLeaf(single(), 'p1', 'row', 'p2'), 'p2', 'row', 'p3')
    expect(siblingLeaf(tree, 'p1', 1).id).toBe('p2')
    expect(siblingLeaf(tree, 'p3', 1).id).toBe('p1')
    expect(siblingLeaf(tree, 'p1', -1).id).toBe('p3')
  })
})
```

The root split created by `splitLeaf` has id `'root'` when the tree root is a leaf being split; nested splits get id `split:<newLeafId>`.

- [x] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/renderer/paneTree.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

`src/renderer/src/ui/layout/paneTree.ts`:
```ts
import { A, O, pipe } from '@mobily/ts-belt'

export type PaneId = string
export type TabId = string
export type SplitDirection = 'row' | 'col'

export type PaneLeaf = { readonly kind: 'leaf'; readonly id: PaneId; readonly tabs: readonly TabId[]; readonly active: TabId | null }
export type PaneSplit = {
  readonly kind: 'split'
  readonly id: PaneId
  readonly direction: SplitDirection
  readonly children: readonly PaneNode[]
  readonly sizes: readonly number[]
}
export type PaneNode = PaneLeaf | PaneSplit

export const createLeaf = (id: PaneId): PaneLeaf => ({ kind: 'leaf', id, tabs: [], active: null })

export const leaves = (tree: PaneNode): PaneLeaf[] =>
  tree.kind === 'leaf' ? [tree] : tree.children.flatMap(leaves)

export const findLeaf = (tree: PaneNode, paneId: PaneId): PaneLeaf | null =>
  pipe(leaves(tree), A.find((l) => l.id === paneId), O.toNullable)

export const leafOfTab = (tree: PaneNode, tabId: TabId): PaneLeaf | null =>
  pipe(leaves(tree), A.find((l) => l.tabs.includes(tabId)), O.toNullable)

const mapNode = (tree: PaneNode, f: (node: PaneNode) => PaneNode): PaneNode => {
  const mapped = f(tree)
  return mapped.kind === 'split' ? { ...mapped, children: mapped.children.map((c) => mapNode(c, f)) } : mapped
}

const updateLeaf = (tree: PaneNode, paneId: PaneId, f: (leaf: PaneLeaf) => PaneLeaf): PaneNode =>
  mapNode(tree, (node) => (node.kind === 'leaf' && node.id === paneId ? f(node) : node))

const insertAt = <T>(xs: readonly T[], index: number, x: T): readonly T[] => [
  ...xs.slice(0, index),
  x,
  ...xs.slice(index),
]

export const addTab = (tree: PaneNode, paneId: PaneId, tabId: TabId, index?: number): PaneNode =>
  updateLeaf(tree, paneId, (leaf) => ({
    ...leaf,
    tabs: insertAt(leaf.tabs, index ?? leaf.tabs.length, tabId),
    active: tabId,
  }))

const nextActive = (tabs: readonly TabId[], removedIndex: number): TabId | null =>
  tabs[removedIndex] ?? tabs[removedIndex - 1] ?? null

export const removeTab = (tree: PaneNode, tabId: TabId): PaneNode =>
  mapNode(tree, (node) => {
    if (node.kind !== 'leaf' || !node.tabs.includes(tabId)) return node
    const index = node.tabs.indexOf(tabId)
    const tabs = node.tabs.filter((t) => t !== tabId)
    const active = node.active === tabId ? nextActive(tabs, index) : node.active
    return { ...node, tabs, active }
  })

export const setActiveTab = (tree: PaneNode, paneId: PaneId, tabId: TabId): PaneNode =>
  updateLeaf(tree, paneId, (leaf) => (leaf.tabs.includes(tabId) ? { ...leaf, active: tabId } : leaf))

export const moveTab = (tree: PaneNode, tabId: TabId, toPaneId: PaneId, index: number): PaneNode =>
  addTab(removeTab(tree, tabId), toPaneId, tabId, index)

const evenSizes = (n: number): readonly number[] => Array.from({ length: n }, () => 1 / n)

const normalize = (sizes: readonly number[]): readonly number[] => {
  const total = sizes.reduce((a, b) => a + b, 0)
  return total === 0 ? evenSizes(sizes.length) : sizes.map((s) => s / total)
}

const splitContaining = (tree: PaneNode, paneId: PaneId): PaneSplit | null => {
  if (tree.kind !== 'split') return null
  if (tree.children.some((c) => c.id === paneId)) return tree
  return pipe(
    tree.children,
    A.map((c) => splitContaining(c, paneId)),
    A.find((s) => s !== null),
    O.toNullable,
  )
}

export const splitLeaf = (tree: PaneNode, paneId: PaneId, direction: SplitDirection, newLeafId: PaneId): PaneNode => {
  const parent = splitContaining(tree, paneId)
  const fresh = createLeaf(newLeafId)

  if (parent && parent.direction === direction) {
    const index = parent.children.findIndex((c) => c.id === paneId)
    const share = parent.sizes[index] ?? 1 / parent.children.length
    const sizes = insertAt(
      parent.sizes.map((s, i) => (i === index ? share / 2 : s)),
      index + 1,
      share / 2,
    )
    return mapNode(tree, (node) =>
      node.id === parent.id && node.kind === 'split'
        ? { ...node, children: insertAt(node.children, index + 1, fresh), sizes: normalize(sizes) }
        : node,
    )
  }

  const splitId = tree.id === paneId ? 'root' : `split:${newLeafId}`
  return mapNode(tree, (node) =>
    node.kind === 'leaf' && node.id === paneId
      ? { kind: 'split', id: splitId, direction, children: [node, fresh], sizes: [0.5, 0.5] }
      : node,
  )
}

const collapse = (node: PaneNode): PaneNode =>
  node.kind === 'split' && node.children.length === 1 ? (node.children[0] as PaneNode) : node

export const closeLeaf = (tree: PaneNode, paneId: PaneId): PaneNode => {
  const parent = splitContaining(tree, paneId)
  if (!parent) return tree

  const index = parent.children.findIndex((c) => c.id === paneId)
  const without: PaneSplit = {
    ...parent,
    children: parent.children.filter((_, i) => i !== index),
    sizes: normalize(parent.sizes.filter((_, i) => i !== index)),
  }

  return collapse(mapNode(tree, (node) => (node.id === parent.id ? without : node)))
}

export const resizeSplit = (tree: PaneNode, splitId: PaneId, sizes: readonly number[]): PaneNode =>
  mapNode(tree, (node) => (node.kind === 'split' && node.id === splitId ? { ...node, sizes: normalize(sizes) } : node))

export const siblingLeaf = (tree: PaneNode, paneId: PaneId, delta: 1 | -1): PaneLeaf => {
  const all = leaves(tree)
  const index = all.findIndex((l) => l.id === paneId)
  const next = (index + delta + all.length) % all.length
  return all[next] as PaneLeaf
}
```

`mapNode` maps parents before children, so a split replacing a leaf is not re-descended into with the same predicate producing duplicates — the `splitLeaf` predicate matches leaf ids only, and the new split's children are the original leaf (already replaced) and a fresh leaf.

- [x] **Step 4: Run tests**

Run: `pnpm vitest run tests/unit/renderer/paneTree.test.ts`
Expected: PASS (16 tests). If `mapNode` re-descends into the freshly created split and wraps the inner `p1` leaf again, change `mapNode` to only recurse into the *original* children: compute `f(tree)`, and if the result is the same object as `tree` (unchanged) recurse; otherwise return the replaced node without descending.

- [x] **Step 5: Commit**

```bash
git add src/renderer/src/ui/layout/paneTree.ts tests/unit/renderer/paneTree.test.ts
git commit -m "feat(layout): pure pane tree operations (tabs, split, close, move, resize)"
```

---

### Task 4: `when` expressions, command registry, editor command table

**Files:**
- Create: `src/renderer/src/commands/when.ts`, `src/renderer/src/commands/registry.ts`, `src/renderer/src/editor/commands.ts`
- Test: `tests/unit/renderer/when.test.ts`, `tests/unit/renderer/registry.test.ts`

**Interfaces:**
- `WhenContext = Readonly<Record<string, boolean | string | undefined>>`; `evaluateWhen(expr: string | undefined, ctx: WhenContext): boolean` — grammar `or := and ('||' and)*; and := unary ('&&' unary)*; unary := '!' unary | primary; primary := ident (('==' | '!=') (ident | string))? | '(' or ')'`. Missing/empty expr → true. Malformed → false (never throws).
- `Command = { id: string; title: string; when?: string; run: (args?: unknown) => void | Promise<void> }`
- `createCommandRegistry(getContext: () => WhenContext)` → `{ register(cmd); registerAll(cmds); get(id): Command | null; list(): readonly Command[]; available(): readonly Command[]; run(id, args?): Promise<boolean> }` — `run` resolves `false` when unknown or `when` is false; re-registering an id replaces the command.
- `editorCommands: readonly { id: string; title: string; run: (view: EditorView) => boolean }[]` — ids: `editor.toggleComment`, `editor.duplicateLine`, `editor.deleteLine`, `editor.selectLine`, `editor.insertLineAfter`, `editor.insertLineBefore`, `editor.indentMore`, `editor.indentLess`, `editor.selectNextOccurrence`, `editor.selectAllOccurrences`, `editor.undoSelection`, `editor.redoSelection`, `editor.matchingBracket`, `editor.selectParent`, `editor.moveLineUp`, `editor.moveLineDown`, `editor.undo`, `editor.redo`, `editor.selectAll`.

- [x] **Step 1: Write the failing tests**

`tests/unit/renderer/when.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { evaluateWhen } from '@renderer/commands/when'

const ctx = { editorFocus: true, terminalFocus: false, hasSelection: false, languageId: 'markdown' }

describe('evaluateWhen', () => {
  it('is true for no expression', () => {
    expect(evaluateWhen(undefined, ctx)).toBe(true)
    expect(evaluateWhen('', ctx)).toBe(true)
    expect(evaluateWhen('   ', ctx)).toBe(true)
  })

  it('reads booleans and treats missing keys as false', () => {
    expect(evaluateWhen('editorFocus', ctx)).toBe(true)
    expect(evaluateWhen('terminalFocus', ctx)).toBe(false)
    expect(evaluateWhen('nope', ctx)).toBe(false)
  })

  it('treats a non-empty string as truthy', () => {
    expect(evaluateWhen('languageId', ctx)).toBe(true)
    expect(evaluateWhen('languageId', { languageId: '' })).toBe(false)
  })

  it('supports negation, and, or with precedence', () => {
    expect(evaluateWhen('!terminalFocus', ctx)).toBe(true)
    expect(evaluateWhen('editorFocus && hasSelection', ctx)).toBe(false)
    expect(evaluateWhen('editorFocus || hasSelection', ctx)).toBe(true)
    expect(evaluateWhen('hasSelection || editorFocus && !terminalFocus', ctx)).toBe(true)
    expect(evaluateWhen('(hasSelection || editorFocus) && terminalFocus', ctx)).toBe(false)
  })

  it('compares against string literals', () => {
    expect(evaluateWhen("languageId == 'markdown'", ctx)).toBe(true)
    expect(evaluateWhen("languageId != 'markdown'", ctx)).toBe(false)
    expect(evaluateWhen("editorFocus && languageId == 'python'", ctx)).toBe(false)
  })

  it('returns false for malformed expressions instead of throwing', () => {
    expect(evaluateWhen('editorFocus &&', ctx)).toBe(false)
    expect(evaluateWhen('(editorFocus', ctx)).toBe(false)
    expect(evaluateWhen("languageId == 'unterminated", ctx)).toBe(false)
  })
})
```

`tests/unit/renderer/registry.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createCommandRegistry } from '@renderer/commands/registry'
import { editorCommands } from '@renderer/editor/commands'

describe('command registry', () => {
  it('registers, lists, and runs commands', async () => {
    const registry = createCommandRegistry(() => ({ editorFocus: true }))
    const run = vi.fn()
    registry.register({ id: 'a.one', title: 'One', run })

    expect(registry.list().map((c) => c.id)).toEqual(['a.one'])
    expect(await registry.run('a.one', { x: 1 })).toBe(true)
    expect(run).toHaveBeenCalledWith({ x: 1 })
  })

  it('refuses unknown ids and commands whose when is false', async () => {
    const registry = createCommandRegistry(() => ({ editorFocus: false }))
    const run = vi.fn()
    registry.register({ id: 'e.x', title: 'X', when: 'editorFocus', run })

    expect(await registry.run('missing')).toBe(false)
    expect(await registry.run('e.x')).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('available() filters by the current context and re-registration replaces', () => {
    const ctx = { editorFocus: false }
    const registry = createCommandRegistry(() => ctx)
    registry.registerAll([
      { id: 'e.x', title: 'X', when: 'editorFocus', run: () => undefined },
      { id: 'g.y', title: 'Y', run: () => undefined },
      { id: 'g.y', title: 'Y2', run: () => undefined },
    ])

    expect(registry.available().map((c) => c.id)).toEqual(['g.y'])
    expect(registry.get('g.y')?.title).toBe('Y2')
    expect(registry.list()).toHaveLength(2)
  })
})

describe('editor command table', () => {
  it('has unique ids that all start with editor. and callable runs', () => {
    const ids = editorCommands.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith('editor.'))).toBe(true)
    expect(editorCommands.every((c) => typeof c.run === 'function' && c.title.length > 0)).toBe(true)
  })
})
```

- [x] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/unit/renderer/when.test.ts tests/unit/renderer/registry.test.ts`
Expected: FAIL — modules not found.

- [x] **Step 3: Implement**

`src/renderer/src/commands/when.ts`:
```ts
export type WhenContext = Readonly<Record<string, boolean | string | undefined>>

type Token =
  | { kind: 'ident'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'op'; value: '&&' | '||' | '!' | '==' | '!=' | '(' | ')' }

const tokenize = (expr: string): Token[] | null => {
  const tokens: Token[] = []
  let i = 0

  while (i < expr.length) {
    const ch = expr[i] as string
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    const two = expr.slice(i, i + 2)
    if (two === '&&' || two === '||' || two === '==' || two === '!=') {
      tokens.push({ kind: 'op', value: two })
      i += 2
      continue
    }
    if (ch === '!' || ch === '(' || ch === ')') {
      tokens.push({ kind: 'op', value: ch })
      i += 1
      continue
    }
    if (ch === "'") {
      const end = expr.indexOf("'", i + 1)
      if (end < 0) return null
      tokens.push({ kind: 'string', value: expr.slice(i + 1, end) })
      i = end + 1
      continue
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(expr.slice(i))
    if (!ident) return null
    tokens.push({ kind: 'ident', value: ident[0] })
    i += ident[0].length
  }

  return tokens
}

type Parser = { readonly tokens: Token[]; pos: number }

const peek = (p: Parser): Token | undefined => p.tokens[p.pos]

const takeOp = (p: Parser, value: string): boolean => {
  const t = peek(p)
  if (t?.kind === 'op' && t.value === value) {
    p.pos += 1
    return true
  }
  return false
}

const valueOf = (ctx: WhenContext, ident: string): boolean | string | undefined => ctx[ident]

const truthy = (v: boolean | string | undefined): boolean => (typeof v === 'string' ? v.length > 0 : v === true)

const parsePrimary = (p: Parser, ctx: WhenContext): boolean | null => {
  if (takeOp(p, '(')) {
    const inner = parseOr(p, ctx)
    return inner !== null && takeOp(p, ')') ? inner : null
  }

  const t = peek(p)
  if (t?.kind !== 'ident') return null
  p.pos += 1

  const next = peek(p)
  if (next?.kind === 'op' && (next.value === '==' || next.value === '!=')) {
    p.pos += 1
    const rhs = peek(p)
    if (!rhs || rhs.kind === 'op') return null
    p.pos += 1
    const left = valueOf(ctx, t.value)
    const right = rhs.kind === 'string' ? rhs.value : valueOf(ctx, rhs.value)
    const equal = String(left ?? '') === String(right ?? '')
    return next.value === '==' ? equal : !equal
  }

  return truthy(valueOf(ctx, t.value))
}

const parseUnary = (p: Parser, ctx: WhenContext): boolean | null => {
  if (takeOp(p, '!')) {
    const v = parseUnary(p, ctx)
    return v === null ? null : !v
  }
  return parsePrimary(p, ctx)
}

const parseAnd = (p: Parser, ctx: WhenContext): boolean | null => {
  let left = parseUnary(p, ctx)
  while (left !== null && takeOp(p, '&&')) {
    const right = parseUnary(p, ctx)
    left = right === null ? null : left && right
  }
  return left
}

const parseOr = (p: Parser, ctx: WhenContext): boolean | null => {
  let left = parseAnd(p, ctx)
  while (left !== null && takeOp(p, '||')) {
    const right = parseAnd(p, ctx)
    left = right === null ? null : left || right
  }
  return left
}

export const evaluateWhen = (expr: string | undefined, ctx: WhenContext): boolean => {
  if (!expr || expr.trim() === '') return true

  const tokens = tokenize(expr)
  if (!tokens) return false

  const parser: Parser = { tokens, pos: 0 }
  const result = parseOr(parser, ctx)
  return result !== null && parser.pos === tokens.length ? result : false
}
```

`src/renderer/src/commands/registry.ts`:
```ts
import { A, D, pipe } from '@mobily/ts-belt'
import { evaluateWhen, type WhenContext } from './when'

export type Command = {
  readonly id: string
  readonly title: string
  readonly when?: string
  readonly run: (args?: unknown) => void | Promise<void>
}

export type CommandRegistry = {
  readonly register: (command: Command) => void
  readonly registerAll: (commands: readonly Command[]) => void
  readonly get: (id: string) => Command | null
  readonly list: () => readonly Command[]
  readonly available: () => readonly Command[]
  readonly run: (id: string, args?: unknown) => Promise<boolean>
}

export const createCommandRegistry = (getContext: () => WhenContext): CommandRegistry => {
  let commands: Record<string, Command> = {}

  const register = (command: Command): void => {
    commands = D.set(commands, command.id, command)
  }

  const list = (): readonly Command[] => D.values(commands)

  const available = (): readonly Command[] =>
    pipe(
      list(),
      A.filter((c) => evaluateWhen(c.when, getContext())),
    )

  const run = async (id: string, args?: unknown): Promise<boolean> => {
    const command = commands[id]
    if (!command || !evaluateWhen(command.when, getContext())) return false
    await command.run(args)
    return true
  }

  return {
    register,
    registerAll: (all) => all.forEach(register),
    get: (id) => commands[id] ?? null,
    list,
    available,
    run,
  }
}
```

`src/renderer/src/editor/commands.ts`:
```ts
import {
  copyLineDown,
  cursorMatchingBracket,
  deleteLine,
  indentLess,
  indentMore,
  insertBlankLine,
  moveLineDown,
  moveLineUp,
  redo,
  redoSelection,
  selectAll,
  selectLine,
  selectParentSyntax,
  toggleComment,
  undo,
  undoSelection,
} from '@codemirror/commands'
import { selectNextOccurrence, selectSelectionMatches } from '@codemirror/search'
import { EditorSelection } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'

export type EditorCommandSpec = { readonly id: string; readonly title: string; readonly run: Command }

const insertLineBefore: Command = (view: EditorView) => {
  const { state } = view
  view.dispatch(
    state.changeByRange((range) => {
      const line = state.doc.lineAt(range.head)
      return { changes: { from: line.from, insert: '\n' }, range: EditorSelection.cursor(line.from) }
    }),
    { scrollIntoView: true, userEvent: 'input' },
  )
  return true
}

export const editorCommands: readonly EditorCommandSpec[] = [
  { id: 'editor.toggleComment', title: 'Toggle Comment', run: toggleComment },
  { id: 'editor.duplicateLine', title: 'Duplicate Line', run: copyLineDown },
  { id: 'editor.deleteLine', title: 'Delete Line', run: deleteLine },
  { id: 'editor.selectLine', title: 'Expand Selection to Line', run: selectLine },
  { id: 'editor.insertLineAfter', title: 'Insert Line After', run: insertBlankLine },
  { id: 'editor.insertLineBefore', title: 'Insert Line Before', run: insertLineBefore },
  { id: 'editor.indentMore', title: 'Indent', run: indentMore },
  { id: 'editor.indentLess', title: 'Unindent', run: indentLess },
  { id: 'editor.selectNextOccurrence', title: 'Quick Add Next', run: selectNextOccurrence },
  { id: 'editor.selectAllOccurrences', title: 'Quick Find All', run: selectSelectionMatches },
  { id: 'editor.undoSelection', title: 'Soft Undo', run: undoSelection },
  { id: 'editor.redoSelection', title: 'Soft Redo', run: redoSelection },
  { id: 'editor.matchingBracket', title: 'Jump to Matching Bracket', run: cursorMatchingBracket },
  { id: 'editor.selectParent', title: 'Expand Selection to Scope', run: selectParentSyntax },
  { id: 'editor.moveLineUp', title: 'Swap Line Up', run: moveLineUp },
  { id: 'editor.moveLineDown', title: 'Swap Line Down', run: moveLineDown },
  { id: 'editor.undo', title: 'Undo', run: undo },
  { id: 'editor.redo', title: 'Redo', run: redo },
  { id: 'editor.selectAll', title: 'Select All', run: selectAll },
]
```

- [x] **Step 4: Run tests**

Run: `pnpm vitest run tests/unit/renderer && pnpm typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/renderer/src/commands src/renderer/src/editor/commands.ts tests/unit/renderer/when.test.ts tests/unit/renderer/registry.test.ts
git commit -m "feat(commands): when-expression evaluator, command registry, editor command table"
```

---

### Task 5: Keymap — key parsing, chord resolution, ST3 defaults

**Files:**
- Create: `src/renderer/src/keymap/keys.ts`, `src/renderer/src/keymap/bindings.ts`, `src/renderer/src/keymap/defaults.ts`
- Test: `tests/unit/renderer/keys.test.ts`, `tests/unit/renderer/bindings.test.ts`

**Interfaces:**
- `Platform = 'mac' | 'win' | 'linux'`; `KeyStroke = { key: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }`
- `parseKeys(keys: string, platform: Platform): readonly KeyStroke[]` — chords are space-separated strokes, modifiers `+`-joined. `mod` → `meta` on mac, `ctrl` otherwise. Aliases: `cmd`/`command`→meta, `ctrl`/`control`, `alt`/`option`, `shift`, `esc`→`escape`, `up/down/left/right`→`arrow*`, `space`, `plus`→`+`, `minus`→`-`. Key part lowercased.
- `strokeFromEvent(e): KeyStroke | null` — `null` for pure modifier presses. `code` `KeyX`→letter, `DigitN`→digit, punctuation codes (`Slash`→`/`, `BracketLeft`→`[`, `BracketRight`→`]`, `Comma`, `Period`, `Semicolon`, `Quote`→`'`, `Backslash`→`\`, `Minus`, `Equal`, `Backquote`→`` ` ``); otherwise `key.toLowerCase()` with `' '`→`space`.
- `strokeEquals(a, b): boolean`; `formatKeys(strokes, platform): string` (mac glyphs `⌃⌥⇧⌘`, else `Ctrl+Alt+Shift+Win+Key`; chords joined by space; key shown uppercased).
- `Binding = { keys: string; command: string; when?: string; args?: unknown }`; `CompiledBinding = Binding & { chord: readonly KeyStroke[] }`
- `compileBindings(bindings, platform): readonly CompiledBinding[]`
- `resolveStroke(bindings, pending: readonly KeyStroke[], stroke, whenOk: (when?: string) => boolean): { kind: 'run'; binding } | { kind: 'pending' } | { kind: 'none' }` — exact chord match wins (last registered exact match); otherwise any longer candidate → pending.
- `findConflicts(bindings): readonly { keys: string; when: string | undefined; commands: readonly string[] }[]`
- `defaultBindings(platform): readonly Binding[]` — ST3 defaults listed below.

- [x] **Step 1: Write the failing tests**

`tests/unit/renderer/keys.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { formatKeys, parseKeys, strokeEquals, strokeFromEvent } from '@renderer/keymap/keys'

const ev = (partial: Partial<KeyboardEvent> & { code: string; key: string }) => ({
  ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...partial,
})

describe('parseKeys', () => {
  it('resolves mod per platform', () => {
    expect(parseKeys('mod+shift+p', 'mac')).toEqual([{ key: 'p', ctrl: false, alt: false, shift: true, meta: true }])
    expect(parseKeys('mod+shift+p', 'win')).toEqual([{ key: 'p', ctrl: true, alt: false, shift: true, meta: false }])
  })

  it('parses chords and aliases', () => {
    expect(parseKeys('cmd+k cmd+d', 'mac')).toHaveLength(2)
    expect(parseKeys('ctrl+/', 'win')[0]?.key).toBe('/')
    expect(parseKeys('Esc', 'mac')[0]?.key).toBe('escape')
    expect(parseKeys('ctrl+up', 'mac')[0]?.key).toBe('arrowup')
    expect(parseKeys('option+space', 'mac')[0]).toEqual({ key: 'space', ctrl: false, alt: true, shift: false, meta: false })
  })
})

describe('strokeFromEvent', () => {
  it('uses code for letters, digits and punctuation', () => {
    expect(strokeFromEvent(ev({ code: 'KeyP', key: 'P', shiftKey: true, metaKey: true }))).toEqual({ key: 'p', ctrl: false, alt: false, shift: true, meta: true })
    expect(strokeFromEvent(ev({ code: 'Slash', key: '?', shiftKey: true }))?.key).toBe('/')
    expect(strokeFromEvent(ev({ code: 'BracketLeft', key: '[' }))?.key).toBe('[')
    expect(strokeFromEvent(ev({ code: 'Digit2', key: '@', shiftKey: true }))?.key).toBe('2')
  })

  it('uses key for named keys', () => {
    expect(strokeFromEvent(ev({ code: 'ArrowUp', key: 'ArrowUp' }))?.key).toBe('arrowup')
    expect(strokeFromEvent(ev({ code: 'Enter', key: 'Enter' }))?.key).toBe('enter')
    expect(strokeFromEvent(ev({ code: 'Space', key: ' ' }))?.key).toBe('space')
    expect(strokeFromEvent(ev({ code: 'F3', key: 'F3' }))?.key).toBe('f3')
  })

  it('ignores pure modifier presses', () => {
    expect(strokeFromEvent(ev({ code: 'ShiftLeft', key: 'Shift', shiftKey: true }))).toBeNull()
    expect(strokeFromEvent(ev({ code: 'MetaLeft', key: 'Meta', metaKey: true }))).toBeNull()
  })

  it('matches parsed strokes', () => {
    const parsed = parseKeys('mod+/', 'mac')[0]!
    expect(strokeEquals(parsed, strokeFromEvent(ev({ code: 'Slash', key: '/', metaKey: true }))!)).toBe(true)
  })
})

describe('formatKeys', () => {
  it('renders platform-specific labels', () => {
    expect(formatKeys(parseKeys('mod+shift+p', 'mac'), 'mac')).toBe('⇧⌘P')
    expect(formatKeys(parseKeys('mod+shift+p', 'win'), 'win')).toBe('Ctrl+Shift+P')
    expect(formatKeys(parseKeys('cmd+k cmd+d', 'mac'), 'mac')).toBe('⌘K ⌘D')
  })
})
```

`tests/unit/renderer/bindings.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { compileBindings, findConflicts, resolveStroke } from '@renderer/keymap/bindings'
import { defaultBindings } from '@renderer/keymap/defaults'
import { parseKeys } from '@renderer/keymap/keys'

const stroke = (keys: string) => parseKeys(keys, 'mac')[0]!
const always = () => true

describe('resolveStroke', () => {
  const compiled = compileBindings(
    [
      { keys: 'mod+d', command: 'editor.selectNextOccurrence', when: 'editorFocus' },
      { keys: 'mod+k mod+d', command: 'editor.skipOccurrence', when: 'editorFocus' },
      { keys: 'mod+k mod+u', command: 'editor.upper', when: 'editorFocus' },
      { keys: 'mod+shift+p', command: 'palette.commands' },
    ],
    'mac',
  )

  it('runs an exact single-stroke match', () => {
    const r = resolveStroke(compiled, [], stroke('mod+d'), always)
    expect(r).toMatchObject({ kind: 'run', binding: { command: 'editor.selectNextOccurrence' } })
  })

  it('reports pending for a chord prefix and runs on completion', () => {
    const first = resolveStroke(compiled, [], stroke('mod+k'), always)
    expect(first.kind).toBe('pending')
    const second = resolveStroke(compiled, [stroke('mod+k')], stroke('mod+d'), always)
    expect(second).toMatchObject({ kind: 'run', binding: { command: 'editor.skipOccurrence' } })
  })

  it('returns none for unbound keys and broken chords', () => {
    expect(resolveStroke(compiled, [], stroke('mod+9'), always).kind).toBe('none')
    expect(resolveStroke(compiled, [stroke('mod+k')], stroke('mod+9'), always).kind).toBe('none')
  })

  it('honours when', () => {
    const r = resolveStroke(compiled, [], stroke('mod+d'), (when) => when === undefined)
    expect(r.kind).toBe('none')
  })

  it('later bindings override earlier ones for the same chord', () => {
    const overlaid = compileBindings(
      [
        { keys: 'mod+d', command: 'a' },
        { keys: 'mod+d', command: 'b' },
      ],
      'mac',
    )
    expect(resolveStroke(overlaid, [], stroke('mod+d'), always)).toMatchObject({ kind: 'run', binding: { command: 'b' } })
  })
})

describe('findConflicts', () => {
  it('reports same chord and same when bound to different commands', () => {
    const compiled = compileBindings(
      [
        { keys: 'mod+d', command: 'a', when: 'editorFocus' },
        { keys: 'mod+d', command: 'b', when: 'editorFocus' },
        { keys: 'mod+d', command: 'c', when: 'terminalFocus' },
        { keys: 'mod+e', command: 'a' },
        { keys: 'mod+e', command: 'a' },
      ],
      'mac',
    )
    expect(findConflicts(compiled)).toEqual([{ keys: 'mod+d', when: 'editorFocus', commands: ['a', 'b'] }])
  })
})

describe('defaultBindings', () => {
  it.each(['mac', 'win'] as const)('%s defaults have no conflicts and parse', (platform) => {
    const compiled = compileBindings(defaultBindings(platform), platform)
    expect(findConflicts(compiled)).toEqual([])
    expect(compiled.every((b) => b.chord.length >= 1 && b.chord.every((s) => s.key.length > 0))).toBe(true)
  })

  it('binds the Sublime essentials', () => {
    const mac = defaultBindings('mac')
    const find = (command: string) => mac.find((b) => b.command === command)?.keys
    expect(find('palette.commands')).toBe('mod+shift+p')
    expect(find('editor.selectNextOccurrence')).toBe('mod+d')
    expect(find('editor.toggleComment')).toBe('mod+/')
    expect(find('file.save')).toBe('mod+s')
    expect(find('tab.close')).toBe('mod+w')
    expect(find('view.splitRight')).toBe('mod+alt+2')
  })
})
```

- [x] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/unit/renderer/keys.test.ts tests/unit/renderer/bindings.test.ts`
Expected: FAIL — modules not found.

- [x] **Step 3: Implement**

`src/renderer/src/keymap/keys.ts`:
```ts
import { A, D, O, pipe } from '@mobily/ts-belt'

export type Platform = 'mac' | 'win' | 'linux'

export type KeyStroke = {
  readonly key: string
  readonly ctrl: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly meta: boolean
}

const modifierAliases: Record<string, 'ctrl' | 'alt' | 'shift' | 'meta' | 'mod'> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  win: 'meta',
  mod: 'mod',
}

const keyAliases: Record<string, string> = {
  esc: 'escape',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  plus: '+',
  minus: '-',
  return: 'enter',
  del: 'delete',
  pgup: 'pageup',
  pgdn: 'pagedown',
}

const empty: KeyStroke = { key: '', ctrl: false, alt: false, shift: false, meta: false }

const parseStroke = (text: string, platform: Platform): KeyStroke => {
  const parts = text.toLowerCase().split('+')
  const keyPart = parts[parts.length - 1] ?? ''
  const key = pipe(D.get(keyAliases, keyPart), O.getWithDefault(keyPart))

  return pipe(
    parts.slice(0, -1),
    A.reduce(empty, (acc, part) => {
      const mod = modifierAliases[part] ?? 'mod'
      const resolved = mod === 'mod' ? (platform === 'mac' ? 'meta' : 'ctrl') : mod
      return { ...acc, [resolved]: true }
    }),
    (s) => ({ ...s, key }),
  )
}

export const parseKeys = (keys: string, platform: Platform): readonly KeyStroke[] =>
  pipe(
    keys.trim().split(/\s+/),
    A.filter((s) => s.length > 0),
    A.map((s) => parseStroke(s, platform)),
  )

const codeToKey: Record<string, string> = {
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'space',
}

const modifierKeys = ['control', 'shift', 'alt', 'meta', 'os', 'altgraph']

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>

const keyFromCode = (code: string, key: string): string => {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return (letter[1] as string).toLowerCase()
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1] as string
  return codeToKey[code] ?? (key === ' ' ? 'space' : key.toLowerCase())
}

export const strokeFromEvent = (e: KeyEventLike): KeyStroke | null => {
  if (modifierKeys.includes(e.key.toLowerCase())) return null

  return { key: keyFromCode(e.code, e.key), ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }
}

export const strokeEquals = (a: KeyStroke, b: KeyStroke): boolean =>
  a.key === b.key && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta

const displayKey = (key: string): string => {
  const named: Record<string, string> = { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', space: 'Space', escape: 'Esc', enter: '↩' }
  return named[key] ?? key.toUpperCase()
}

const formatStroke = (s: KeyStroke, platform: Platform): string =>
  platform === 'mac'
    ? `${s.ctrl ? '⌃' : ''}${s.alt ? '⌥' : ''}${s.shift ? '⇧' : ''}${s.meta ? '⌘' : ''}${displayKey(s.key)}`
    : [s.ctrl && 'Ctrl', s.alt && 'Alt', s.shift && 'Shift', s.meta && 'Win', displayKey(s.key)].filter(Boolean).join('+')

export const formatKeys = (strokes: readonly KeyStroke[], platform: Platform): string =>
  strokes.map((s) => formatStroke(s, platform)).join(' ')
```

`src/renderer/src/keymap/bindings.ts`:
```ts
import { A, pipe } from '@mobily/ts-belt'
import { type KeyStroke, type Platform, parseKeys, strokeEquals } from './keys'

export type Binding = {
  readonly keys: string
  readonly command: string
  readonly when?: string
  readonly args?: unknown
}

export type CompiledBinding = Binding & { readonly chord: readonly KeyStroke[] }

export type Resolution =
  | { readonly kind: 'run'; readonly binding: CompiledBinding }
  | { readonly kind: 'pending' }
  | { readonly kind: 'none' }

export const compileBindings = (bindings: readonly Binding[], platform: Platform): readonly CompiledBinding[] =>
  bindings.map((b) => ({ ...b, chord: parseKeys(b.keys, platform) }))

const startsWith = (chord: readonly KeyStroke[], prefix: readonly KeyStroke[]): boolean =>
  prefix.length <= chord.length && prefix.every((s, i) => strokeEquals(s, chord[i] as KeyStroke))

export const resolveStroke = (
  bindings: readonly CompiledBinding[],
  pending: readonly KeyStroke[],
  stroke: KeyStroke,
  whenOk: (when?: string) => boolean,
): Resolution => {
  const sequence = [...pending, stroke]
  const candidates = pipe(
    bindings,
    A.filter((b) => startsWith(b.chord, sequence) && whenOk(b.when)),
  )

  const exact = pipe(
    candidates,
    A.filter((b) => b.chord.length === sequence.length),
    A.last,
  )
  if (exact) return { kind: 'run', binding: exact }

  return candidates.length > 0 ? { kind: 'pending' } : { kind: 'none' }
}

const chordKey = (b: CompiledBinding): string =>
  `${b.chord.map((s) => `${s.ctrl ? 'c' : ''}${s.alt ? 'a' : ''}${s.shift ? 's' : ''}${s.meta ? 'm' : ''}:${s.key}`).join(' ')}|${b.when ?? ''}`

export const findConflicts = (
  bindings: readonly CompiledBinding[],
): readonly { keys: string; when: string | undefined; commands: readonly string[] }[] =>
  pipe(
    bindings,
    A.groupBy(chordKey),
    (groups) => Object.values(groups),
    A.filter((group): group is CompiledBinding[] => group !== undefined),
    A.map((group) => ({
      keys: group[0]?.keys ?? '',
      when: group[0]?.when,
      commands: A.uniq(group.map((b) => b.command)),
    })),
    A.filter((g) => g.commands.length > 1),
    (xs) => [...xs],
  )
```

`src/renderer/src/keymap/defaults.ts`:
```ts
import type { Binding } from './bindings'
import type { Platform } from './keys'

const editor = (keys: string, command: string): Binding => ({ keys, command, when: 'editorFocus' })

const common: readonly Binding[] = [
  { keys: 'mod+n', command: 'file.new' },
  { keys: 'mod+o', command: 'file.open' },
  { keys: 'mod+s', command: 'file.save' },
  { keys: 'mod+shift+s', command: 'file.saveAs' },
  { keys: 'mod+w', command: 'tab.close' },
  { keys: 'mod+shift+p', command: 'palette.commands' },
  { keys: 'mod+alt+2', command: 'view.splitRight' },
  { keys: 'mod+alt+shift+2', command: 'view.splitDown' },
  { keys: 'mod+alt+1', command: 'view.singlePane' },
  { keys: 'ctrl+1', command: 'view.focusPane', args: 1 },
  { keys: 'ctrl+2', command: 'view.focusPane', args: 2 },
  { keys: 'ctrl+3', command: 'view.focusPane', args: 3 },
  { keys: 'ctrl+4', command: 'view.focusPane', args: 4 },
  { keys: 'ctrl+tab', command: 'tab.next' },
  { keys: 'ctrl+shift+tab', command: 'tab.prev' },
  editor('mod+/', 'editor.toggleComment'),
  editor('mod+shift+d', 'editor.duplicateLine'),
  editor('ctrl+shift+k', 'editor.deleteLine'),
  editor('mod+l', 'editor.selectLine'),
  editor('mod+enter', 'editor.insertLineAfter'),
  editor('mod+shift+enter', 'editor.insertLineBefore'),
  editor('mod+]', 'editor.indentMore'),
  editor('mod+[', 'editor.indentLess'),
  editor('mod+d', 'editor.selectNextOccurrence'),
  editor('mod+u', 'editor.undoSelection'),
  editor('mod+shift+u', 'editor.redoSelection'),
  editor('ctrl+m', 'editor.matchingBracket'),
  editor('mod+shift+space', 'editor.selectParent'),
  editor('mod+z', 'editor.undo'),
  editor('mod+shift+z', 'editor.redo'),
]

const tabSelect = (prefix: string): readonly Binding[] =>
  Array.from({ length: 9 }, (_, i) => ({ keys: `${prefix}+${i + 1}`, command: 'tab.select', args: i + 1 }))

const mac: readonly Binding[] = [
  ...tabSelect('mod'),
  editor('ctrl+mod+arrowup', 'editor.moveLineUp'),
  editor('ctrl+mod+arrowdown', 'editor.moveLineDown'),
  editor('ctrl+mod+g', 'editor.selectAllOccurrences'),
]

const win: readonly Binding[] = [
  ...tabSelect('alt'),
  editor('ctrl+shift+arrowup', 'editor.moveLineUp'),
  editor('ctrl+shift+arrowdown', 'editor.moveLineDown'),
  editor('alt+f3', 'editor.selectAllOccurrences'),
  editor('ctrl+y', 'editor.redo'),
]

export const defaultBindings = (platform: Platform): readonly Binding[] => [
  ...common,
  ...(platform === 'mac' ? mac : win),
]
```

- [x] **Step 4: Run tests**

Run: `pnpm vitest run tests/unit/renderer && pnpm typecheck`
Expected: PASS. If `A.groupBy` typing in `findConflicts` fights you, replace the pipe with a plain reduce into `Record<string, CompiledBinding[]>` — the behavior matters, not the combinator.

- [x] **Step 5: Commit**

```bash
git add src/renderer/src/keymap tests/unit/renderer/keys.test.ts tests/unit/renderer/bindings.test.ts
git commit -m "feat(keymap): key parsing, chord resolution, conflict detection, Sublime default bindings"
```

---

### Task 6: Workspace store, pane/tab UI, editor hosts, keymap wiring, App rewrite

**Files:**
- Create: `src/renderer/src/app/workspace.ts`, `src/renderer/src/app/context.ts`, `src/renderer/src/ui/layout/PaneView.tsx`, `src/renderer/src/ui/layout/SplitGutter.tsx`, `src/renderer/src/ui/tabs/TabStrip.tsx`, `src/renderer/src/ui/editor/EditorHost.tsx`, `src/renderer/src/ui/statusbar/StatusBar.tsx`, `src/renderer/src/app/registerCommands.ts`, `src/renderer/src/app/useKeymap.ts`
- Rewrite: `src/renderer/src/App.tsx`, `src/renderer/src/testHooks.ts`
- Modify: `src/renderer/src/editor/createEditor.ts` (delete the temporary `Editor`/`createEditor` leftovers), `src/renderer/src/style.css`, `tests/e2e/types.d.ts`, `tests/e2e/file.spec.ts`, `tests/e2e/roundtrip.spec.ts`
- Test: `tests/e2e/tabs.spec.ts`, `tests/e2e/split.spec.ts`, `tests/e2e/keymap.spec.ts`

**Interfaces:**

`workspace.ts`
```ts
type Tab = { id: TabId; kind: 'buffer'; bufferId: BufferId }
type BufferMeta = { id: BufferId; path: string | null; title: string; dirty: boolean; languageId: string }
type Cursor = { line: number; col: number }
type WorkspaceState = { tree: PaneNode; tabs: Record<TabId, Tab>; buffers: Record<BufferId, BufferMeta>; activePane: PaneId; editorFocused: boolean; cursor: Cursor; status: string }
type Workspace = {
  state: WorkspaceState                       // Solid store (read)
  getBuffer(id: BufferId): Buffer | null
  activeLeaf(): PaneLeaf
  activeBuffer(): Buffer | null
  activeView(): EditorView | null
  registerView(paneId: PaneId, view: EditorView): void
  unregisterView(paneId: PaneId): void
  openFile(path: string): Promise<boolean>
  newUntitled(): void
  closeTab(tabId?: TabId): Promise<void>
  activateTab(paneId: PaneId, tabId: TabId): void
  selectTabIndex(n: number): void
  cycleTab(delta: 1 | -1): void
  splitActive(direction: 'row' | 'col'): void
  singlePane(): void
  focusPaneIndex(n: number): void
  focusPane(paneId: PaneId): void
  resizeSplit(splitId: PaneId, sizes: readonly number[]): void
  save(mode?: 'normal' | 'overwrite'): Promise<void>
  saveAs(): Promise<void>
  setStatus(text: string): void
}
createWorkspace(deps: { confirmClose: (title: string) => Promise<'save' | 'dontSave' | 'cancel'> }): Workspace
```

`context.ts`: `whenContext(ws: Workspace): WhenContext` → `{ editorFocus, hasSelection, hasMultipleSelections, languageId, paletteOpen? }` (palette flag is merged in App).

`registerCommands.ts`: `registerAppCommands(registry, ws, ui: { openPalette(): void })` registers: `file.new`, `file.open`, `file.save`, `file.saveAs`, `tab.close`, `tab.next`, `tab.prev`, `tab.select` (args: number), `view.splitRight`, `view.splitDown`, `view.singlePane`, `view.focusPane` (args: number), `palette.commands`, and every `editorCommands` entry as `{ id, title, when: 'editorFocus', run: () => { const v = ws.activeView(); if (v) spec.run(v) } }`.

`useKeymap.ts`: `installKeymap(window, compiled: readonly CompiledBinding[], registry, getContext): () => void` — capture-phase keydown; chord state; `Escape` clears pending; returns uninstall.

Test hooks (`window.__moruTest`):
```ts
doc(): string; selections(); composing(); focus(); setCursor(pos); setWhitespace(on)   // on the active view
path(): string | null; meta(): FileMeta | null; saveAs(mode): Promise<void>
tabs(): { paneId: string; active: boolean; tabs: { path: string | null; title: string; dirty: boolean; active: boolean }[] }[]
runCommand(id: string, args?: unknown): Promise<boolean>
openPath(path: string): Promise<boolean>
paletteOpen(): boolean
```

- [x] **Step 1: Write the failing E2E tests**

`tests/e2e/tabs.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const tabs = (page: import('@playwright/test').Page) => page.evaluate(() => window.__moruTest!.tabs())

const twoFiles = () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-tabs-'))
  const a = join(dir, 'a.ts')
  const b = join(dir, 'b.md')
  writeFileSync(a, 'const a = 1\n')
  writeFileSync(b, '# b\n')
  return { a, b }
}

test('startup paths open as tabs with the last one active', async () => {
  const { a, b } = twoFiles()
  const { app, page } = await launchApp({ MORU_TEST_OPEN: `${a}${process.platform === 'win32' ? ';' : ':'}${b}` })

  await expect.poll(async () => (await tabs(page))[0]?.tabs.map((t) => t.title)).toEqual(['a.ts', 'b.md'])
  expect((await tabs(page))[0]?.tabs.find((t) => t.active)?.title).toBe('b.md')
  await expect(page.getByTestId('path')).toHaveText(b)

  await app.close()
})

test('switching tabs keeps each buffer text, dirty flag and undo history', async () => {
  const { a, b } = twoFiles()
  const { app, page } = await launchApp({ MORU_TEST_OPEN: `${a}${process.platform === 'win32' ? ';' : ':'}${b}` })
  await expect.poll(async () => (await tabs(page))[0]?.tabs.length).toBe(2)

  await page.keyboard.press(`${mod}+1`)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('const a = 1\n')
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('// x\n')
  await expect.poll(async () => (await tabs(page))[0]?.tabs[0]?.dirty).toBe(true)

  await page.keyboard.press(`${mod}+2`)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('# b\n')
  expect((await tabs(page))[0]?.tabs[1]?.dirty).toBe(false)

  await page.keyboard.press(`${mod}+1`)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('// x\nconst a = 1\n')
  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+z`)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('const a = 1\n')
  await expect.poll(async () => (await tabs(page))[0]?.tabs[0]?.dirty).toBe(false)

  await app.close()
})

test('tab.close removes the active tab and ctrl+tab cycles', async () => {
  const { a, b } = twoFiles()
  const { app, page } = await launchApp({ MORU_TEST_OPEN: `${a}${process.platform === 'win32' ? ';' : ':'}${b}` })
  await expect.poll(async () => (await tabs(page))[0]?.tabs.length).toBe(2)

  await page.keyboard.press('Control+Tab')
  await expect.poll(async () => (await tabs(page))[0]?.tabs.find((t) => t.active)?.title).toBe('a.ts')

  await page.evaluate(() => window.__moruTest!.runCommand('tab.close'))
  await expect.poll(async () => (await tabs(page))[0]?.tabs.map((t) => t.title)).toEqual(['b.md'])

  await page.evaluate(() => window.__moruTest!.runCommand('file.new'))
  await expect.poll(async () => (await tabs(page))[0]?.tabs.map((t) => t.title)).toEqual(['b.md', 'untitled'])
  await expect(page.getByTestId('path')).toHaveText('untitled')

  await app.close()
})
```

`MORU_TEST_OPEN` now accepts a `path.delimiter`-separated list (main splits it).

`tests/e2e/split.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')
const panes = (page: import('@playwright/test').Page) => page.evaluate(() => window.__moruTest!.tabs())

test('split right creates an empty active pane; opening a file lands there; single pane merges back', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(async () => (await panes(page)).length).toBe(1)

  await page.evaluate(() => window.__moruTest!.runCommand('view.splitRight'))
  await expect.poll(async () => (await panes(page)).length).toBe(2)
  const after = await panes(page)
  expect(after[1]?.active).toBe(true)
  expect(after[1]?.tabs).toEqual([])
  await expect(page.locator('.pane')).toHaveCount(2)

  await page.evaluate(() => window.__moruTest!.runCommand('file.new'))
  await expect.poll(async () => (await panes(page))[1]?.tabs.map((t) => t.title)).toEqual(['untitled'])

  await page.evaluate(() => window.__moruTest!.runCommand('view.focusPane', 1))
  await expect.poll(async () => (await panes(page))[0]?.active).toBe(true)

  await page.evaluate(() => window.__moruTest!.runCommand('view.singlePane'))
  await expect.poll(async () => (await panes(page)).length).toBe(1)
  expect((await panes(page))[0]?.tabs.map((t) => t.title)).toEqual(['ime.ts', 'untitled'])

  await app.close()
})

test('split down nests a column split and closing the pane collapses it', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })

  await page.evaluate(() => window.__moruTest!.runCommand('view.splitRight'))
  await page.evaluate(() => window.__moruTest!.runCommand('view.splitDown'))
  await expect.poll(async () => (await panes(page)).length).toBe(3)
  await expect(page.locator('.split.col')).toHaveCount(1)

  await page.evaluate(() => window.__moruTest!.runCommand('view.closePane'))
  await expect.poll(async () => (await panes(page)).length).toBe(2)
  await page.evaluate(() => window.__moruTest!.runCommand('view.closePane'))
  await expect.poll(async () => (await panes(page)).length).toBe(1)
  await page.evaluate(() => window.__moruTest!.runCommand('view.closePane'))
  expect((await panes(page)).length).toBe(1)

  await app.close()
})
```

(`view.closePane` is registered alongside the others; it closes the active pane and moves its tabs to the sibling.)

`tests/e2e/keymap.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const doc = (page: import('@playwright/test').Page) => page.evaluate(() => window.__moruTest!.doc())

test('Sublime bindings reach CodeMirror commands', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(() => doc(page)).toContain('const foo = 1;')

  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))

  await page.keyboard.press(`${mod}+/`)
  await expect.poll(() => doc(page)).toContain('// const greeting = "";')

  await page.keyboard.press(`${mod}+/`)
  await expect.poll(() => doc(page)).not.toContain('// const greeting')

  await page.keyboard.press(`${mod}+Shift+d`)
  await expect.poll(() => doc(page)).toBe('const greeting = "";\nconst greeting = "";\nconst foo = 1;\nconst bar = foo + foo;\n')

  await page.keyboard.press('Control+Shift+k')
  await expect.poll(() => doc(page)).toBe('const greeting = "";\nconst foo = 1;\nconst bar = foo + foo;\n')

  await page.keyboard.press(`${mod}+l`)
  const sel = await page.evaluate(() => window.__moruTest!.selections())
  expect(sel[0]).toEqual({ from: 0, to: 21 })

  await app.close()
})

test('bindings do not fire while the editor is not focused', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(() => doc(page)).toContain('const foo = 1;')

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press(`${mod}+/`)
  await page.waitForTimeout(100)
  expect(await doc(page)).not.toContain('//')

  await app.close()
})
```

Modify `tests/e2e/file.spec.ts` and `tests/e2e/roundtrip.spec.ts`: replace every `await page.getByTestId('save').click()` with `await page.evaluate(() => window.__moruTest!.runCommand('file.save'))`.

Add to `tests/e2e/types.d.ts` `MoruTestHooks`:
```ts
  tabs(): { paneId: string; active: boolean; tabs: { path: string | null; title: string; dirty: boolean; active: boolean }[] }[]
  runCommand(id: string, args?: unknown): Promise<boolean>
  openPath(path: string): Promise<boolean>
  paletteOpen(): boolean
```

- [x] **Step 2: Run to verify they fail**

Run: `pnpm build && pnpm exec playwright test tests/e2e/tabs.spec.ts tests/e2e/split.spec.ts tests/e2e/keymap.spec.ts`
Expected: FAIL (`tabs` hook missing).

- [x] **Step 3: Main — split `MORU_TEST_OPEN` on `path.delimiter`**

In `src/main/index.ts` `startupPaths`, replace the `fromEnv` line with:
```ts
  const fromEnv = (process.env['MORU_TEST_OPEN'] ?? '').split(delimiter).filter((p) => p.length > 0)
```
and import `delimiter` from `node:path`.

- [x] **Step 4: Implement the workspace**

`src/renderer/src/app/workspace.ts`:
```ts
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { A, D, R, pipe } from '@mobily/ts-belt'
import { createStore, produce, type SetStoreFunction } from 'solid-js/store'
import type { OpenedFile, SaveError } from '@shared/ipc'
import { type Buffer, type BufferId, type FileMeta, createBuffer, isDirty, markSaved, titleOf } from '../editor/buffers'
import { baseExtensions, makeState } from '../editor/createEditor'
import { cursorPosition, type CursorPosition } from '../editor/cursor'
import { languageById } from '../editor/lang'
import { invoke } from '../ipc'
import {
  addTab, closeLeaf, createLeaf, findLeaf, leafOfTab, leaves, moveTab, type PaneId, type PaneLeaf, type PaneNode,
  removeTab, resizeSplit as resizeSplitTree, setActiveTab, siblingLeaf, splitLeaf, type TabId,
} from '../ui/layout/paneTree'

export type Tab = { readonly id: TabId; readonly kind: 'buffer'; readonly bufferId: BufferId }
export type BufferMeta = { readonly id: BufferId; readonly path: string | null; readonly title: string; readonly dirty: boolean; readonly languageId: string }
export type CloseChoice = 'save' | 'dontSave' | 'cancel'

export type WorkspaceState = {
  tree: PaneNode
  tabs: Record<TabId, Tab>
  buffers: Record<BufferId, BufferMeta>
  activePane: PaneId
  editorFocused: boolean
  cursor: CursorPosition
  status: string
}

export type Workspace = {
  readonly state: WorkspaceState
  readonly getBuffer: (id: BufferId) => Buffer | null
  readonly activeLeaf: () => PaneLeaf
  readonly activeBuffer: () => Buffer | null
  readonly activeView: () => EditorView | null
  readonly registerView: (paneId: PaneId, view: EditorView) => void
  readonly unregisterView: (paneId: PaneId) => void
  readonly openFile: (path: string) => Promise<boolean>
  readonly newUntitled: () => void
  readonly closeTab: (tabId?: TabId) => Promise<void>
  readonly activateTab: (paneId: PaneId, tabId: TabId) => void
  readonly selectTabIndex: (n: number) => void
  readonly cycleTab: (delta: 1 | -1) => void
  readonly splitActive: (direction: 'row' | 'col') => void
  readonly closeActivePane: () => void
  readonly singlePane: () => void
  readonly focusPaneIndex: (n: number) => void
  readonly focusPane: (paneId: PaneId) => void
  readonly resizeSplit: (splitId: PaneId, sizes: readonly number[]) => void
  readonly save: (mode?: 'normal' | 'overwrite') => Promise<void>
  readonly saveAs: () => Promise<void>
  readonly setStatus: (text: string) => void
}

type Deps = { readonly confirmClose: (title: string) => Promise<CloseChoice> }

const describeSaveError = (error: SaveError): string => {
  switch (error.kind) {
    case 'conflict':
      return 'conflict: file changed on disk (use overwrite to replace it)'
    case 'encodingLossy':
      return `encoding cannot represent ${error.positions.length} character(s); save as UTF-8?`
    case 'readonly':
      return `read-only: ${error.message}`
    default:
      return `save failed: ${error.message}`
  }
}

const metaOf = (buffer: Buffer): BufferMeta => ({
  id: buffer.id,
  path: buffer.meta?.path ?? null,
  title: titleOf(buffer),
  dirty: isDirty(buffer),
  languageId: buffer.languageId,
})

const counter = (prefix: string) => {
  let n = 0
  return (): string => `${prefix}${(n += 1)}`
}

export const createWorkspace = ({ confirmClose }: Deps): Workspace => {
  const nextBufferId = counter('b')
  const nextTabId = counter('t')
  const nextPaneId = counter('p')

  const firstPane = nextPaneId()
  const [state, setState]: [WorkspaceState, SetStoreFunction<WorkspaceState>] = createStore<WorkspaceState>({
    tree: createLeaf(firstPane),
    tabs: {},
    buffers: {},
    activePane: firstPane,
    editorFocused: false,
    cursor: { line: 1, col: 1 },
    status: '',
  })

  let buffers: Record<BufferId, Buffer> = {}
  let views: Record<PaneId, EditorView> = {}

  const paneOfView = (view: EditorView): PaneId | null =>
    pipe(
      D.toPairs(views),
      A.find(([, v]) => v === view),
      (found) => (found ? found[0] : null),
    )

  const bufferInPane = (paneId: PaneId): Buffer | null => {
    const leaf = findLeaf(state.tree, paneId)
    const tab = leaf?.active ? state.tabs[leaf.active] : undefined
    return tab ? (buffers[tab.bufferId] ?? null) : null
  }

  const syncMeta = (buffer: Buffer): void => {
    const next = metaOf(buffer)
    const prev = state.buffers[buffer.id]
    if (!prev || prev.dirty !== next.dirty || prev.title !== next.title || prev.path !== next.path || prev.languageId !== next.languageId) {
      setState('buffers', buffer.id, next)
    }
  }

  const putBuffer = (buffer: Buffer): void => {
    buffers = D.set(buffers, buffer.id, buffer)
    syncMeta(buffer)
  }

  const onUpdate = (editorState: EditorState, view: EditorView): void => {
    const paneId = paneOfView(view)
    const buffer = paneId ? bufferInPane(paneId) : null
    if (!buffer) return

    putBuffer({ ...buffer, state: editorState })
    if (paneId === state.activePane) setState('cursor', cursorPosition(editorState))
  }

  const onFocusChange = (view: EditorView, focused: boolean): void => {
    const paneId = paneOfView(view)
    if (focused && paneId) setState({ activePane: paneId, editorFocused: true })
    if (!focused) setState('editorFocused', false)
  }

  const stateFor = (doc: string, languageId: string): EditorState =>
    makeState(doc, baseExtensions(languageById(languageId).load(), {
      onUpdate: (s, view) => onUpdate(s, view),
      onFocusChange,
    }))

  const activeLeaf = (): PaneLeaf => findLeaf(state.tree, state.activePane) ?? (leaves(state.tree)[0] as PaneLeaf)

  const activeBuffer = (): Buffer | null => bufferInPane(state.activePane)

  const activeView = (): EditorView | null => views[state.activePane] ?? null

  const focusView = (paneId: PaneId): void => {
    setState('activePane', paneId)
    views[paneId]?.focus()
  }

  const addBufferTab = (buffer: Buffer): void => {
    const tab: Tab = { id: nextTabId(), kind: 'buffer', bufferId: buffer.id }
    putBuffer(buffer)
    setState(
      produce((s) => {
        s.tabs[tab.id] = tab
        s.tree = addTab(s.tree, s.activePane, tab.id)
      }),
    )
  }

  const tabForPath = (path: string): { paneId: PaneId; tabId: TabId } | null =>
    pipe(
      D.values(state.tabs),
      A.find((t) => buffers[t.bufferId]?.meta?.path === path),
      (tab) => {
        const leaf = tab ? leafOfTab(state.tree, tab.id) : null
        return tab && leaf ? { paneId: leaf.id, tabId: tab.id } : null
      },
    )

  const openFile = async (path: string): Promise<boolean> => {
    const existing = tabForPath(path)
    if (existing) {
      setState('tree', setActiveTab(state.tree, existing.paneId, existing.tabId))
      focusView(existing.paneId)
      return true
    }

    const result = await invoke('fs.open', { path })
    return R.match(
      result,
      (file: OpenedFile) => {
        addBufferTab(createBuffer(nextBufferId(), file, stateFor))
        setState('status', `opened ${file.path}`)
        return true
      },
      (error) => {
        setState('status', `open failed: ${error.message}`)
        return false
      },
    )
  }

  const newUntitled = (): void => addBufferTab(createBuffer(nextBufferId(), null, stateFor))

  const dropTab = (tabId: TabId): void => {
    const tab = state.tabs[tabId]
    if (!tab) return
    buffers = D.deleteKey(buffers, tab.bufferId)
    setState(
      produce((s) => {
        s.tree = removeTab(s.tree, tabId)
        delete s.tabs[tabId]
        delete s.buffers[tab.bufferId]
      }),
    )
  }

  const saveBuffer = async (buffer: Buffer, mode: 'normal' | 'overwrite', path: string): Promise<boolean> => {
    const encoding = buffer.meta?.encoding ?? 'utf8'
    const bom = buffer.meta?.bom ?? false
    const eol = buffer.meta?.eol ?? 'lf'

    const result = await invoke('fs.save', {
      path,
      text: buffer.state.doc.toString(),
      encoding,
      bom,
      eol,
      expectedHash: buffer.meta?.path === path ? buffer.meta.hash : null,
      mode,
    })

    return R.match(
      result,
      (saved) => {
        const meta: FileMeta = {
          path: saved.path, encoding, bom, eol, mixedEol: false, confidence: 'high',
          hash: saved.hash, mtimeMs: saved.mtimeMs, readonly: false, largeFile: buffer.meta?.largeFile ?? false,
        }
        const current = buffers[buffer.id] ?? buffer
        putBuffer(markSaved(current, meta))
        setState('status', `saved ${saved.bytes} bytes`)
        return true
      },
      (error) => {
        setState('status', describeSaveError(error))
        return false
      },
    )
  }

  const pickSavePath = async (current: string | null): Promise<string | null> => {
    const picked = await invoke('dialog.saveFile', current)
    return R.match(picked, (d) => d.path, () => null)
  }

  const save = async (mode: 'normal' | 'overwrite' = 'normal'): Promise<void> => {
    const buffer = activeBuffer()
    if (!buffer) return
    const path = buffer.meta?.path ?? (await pickSavePath(null))
    if (path) await saveBuffer(buffer, mode, path)
  }

  const saveAs = async (): Promise<void> => {
    const buffer = activeBuffer()
    if (!buffer) return
    const path = await pickSavePath(buffer.meta?.path ?? null)
    if (path) await saveBuffer(buffer, 'overwrite', path)
  }

  const closeTab = async (tabId?: TabId): Promise<void> => {
    const target = tabId ?? activeLeaf().active
    const tab = target ? state.tabs[target] : undefined
    const buffer = tab ? buffers[tab.bufferId] : undefined
    if (!tab || !buffer) return

    if (isDirty(buffer)) {
      const choice = await confirmClose(titleOf(buffer))
      if (choice === 'cancel') return
      if (choice === 'save') {
        const path = buffer.meta?.path ?? (await pickSavePath(null))
        if (!path || !(await saveBuffer(buffer, 'normal', path))) return
      }
    }

    dropTab(tab.id)
  }

  const activateTab = (paneId: PaneId, tabId: TabId): void => {
    setState('tree', setActiveTab(state.tree, paneId, tabId))
    focusView(paneId)
  }

  const selectTabIndex = (n: number): void => {
    const leaf = activeLeaf()
    const tabId = leaf.tabs[n - 1]
    if (tabId) activateTab(leaf.id, tabId)
  }

  const cycleTab = (delta: 1 | -1): void => {
    const leaf = activeLeaf()
    if (leaf.tabs.length === 0 || !leaf.active) return
    const index = leaf.tabs.indexOf(leaf.active)
    const next = leaf.tabs[(index + delta + leaf.tabs.length) % leaf.tabs.length]
    if (next) activateTab(leaf.id, next)
  }

  const splitActive = (direction: 'row' | 'col'): void => {
    const fresh = nextPaneId()
    setState('tree', splitLeaf(state.tree, state.activePane, direction, fresh))
    setState('activePane', fresh)
  }

  const closeActivePane = (): void => {
    const all = leaves(state.tree)
    if (all.length <= 1) return
    const closing = activeLeaf()
    const target = siblingLeaf(state.tree, closing.id, -1)
    const moved = closing.tabs.reduce((tree, tabId) => moveTab(tree, tabId, target.id, findLeaf(tree, target.id)?.tabs.length ?? 0), state.tree)
    setState('tree', closeLeaf(moved, closing.id))
    focusView(target.id)
  }

  const singlePane = (): void => {
    const all = leaves(state.tree)
    const first = all[0]
    if (!first || all.length === 1) return
    const others = all.slice(1)
    const merged = others.reduce(
      (tree, leaf) => leaf.tabs.reduce((t, tabId) => moveTab(t, tabId, first.id, findLeaf(t, first.id)?.tabs.length ?? 0), tree),
      state.tree,
    )
    const collapsed = others.reduce((tree, leaf) => closeLeaf(tree, leaf.id), merged)
    setState('tree', collapsed)
    focusView(first.id)
  }

  const focusPaneIndex = (n: number): void => {
    const leaf = leaves(state.tree)[n - 1]
    if (leaf) focusView(leaf.id)
  }

  return {
    state,
    getBuffer: (id) => buffers[id] ?? null,
    activeLeaf,
    activeBuffer,
    activeView,
    registerView: (paneId, view) => {
      views = D.set(views, paneId, view)
    },
    unregisterView: (paneId) => {
      views = D.deleteKey(views, paneId)
    },
    openFile,
    newUntitled,
    closeTab,
    activateTab,
    selectTabIndex,
    cycleTab,
    splitActive,
    closeActivePane,
    singlePane,
    focusPaneIndex,
    focusPane: focusView,
    resizeSplit: (splitId, sizes) => setState('tree', resizeSplitTree(state.tree, splitId, sizes)),
    save,
    saveAs,
    setStatus: (text) => setState('status', text),
  }
}
```

Change `ViewHooks.onUpdate` in `createEditor.ts` to `(state: EditorState, view: EditorView) => void` and `onFocusChange` to `(view: EditorView, focused: boolean) => void`; pass `update.view` in both calls. Delete the temporary `Editor` type and `createEditor` function.

`src/renderer/src/app/context.ts`:
```ts
import type { WhenContext } from '../commands/when'
import type { Workspace } from './workspace'

export const whenContext = (ws: Workspace, extra: Record<string, boolean | string> = {}): WhenContext => {
  const view = ws.activeView()
  const selection = view?.state.selection
  return {
    editorFocus: ws.state.editorFocused,
    hasSelection: selection ? selection.ranges.some((r) => !r.empty) : false,
    hasMultipleSelections: selection ? selection.ranges.length > 1 : false,
    languageId: ws.activeBuffer()?.languageId ?? '',
    ...extra,
  }
}
```

`src/renderer/src/app/registerCommands.ts`:
```ts
import type { CommandRegistry } from '../commands/registry'
import { editorCommands } from '../editor/commands'
import { invoke } from '../ipc'
import type { Workspace } from './workspace'
import { R } from '@mobily/ts-belt'

type Ui = { readonly openPalette: () => void }

const asIndex = (args: unknown): number => (typeof args === 'number' ? args : Number(args) || 1)

export const registerAppCommands = (registry: CommandRegistry, ws: Workspace, ui: Ui): void => {
  registry.registerAll([
    { id: 'file.new', title: 'File: New File', run: () => ws.newUntitled() },
    {
      id: 'file.open',
      title: 'File: Open…',
      run: async () => {
        const picked = await invoke('dialog.openFile', undefined)
        await R.match(picked, async ({ path }) => { if (path) await ws.openFile(path) }, async () => undefined)
      },
    },
    { id: 'file.save', title: 'File: Save', run: () => ws.save() },
    { id: 'file.saveAs', title: 'File: Save As…', run: () => ws.saveAs() },
    { id: 'tab.close', title: 'Tab: Close', run: () => ws.closeTab() },
    { id: 'tab.next', title: 'Tab: Next', run: () => ws.cycleTab(1) },
    { id: 'tab.prev', title: 'Tab: Previous', run: () => ws.cycleTab(-1) },
    { id: 'tab.select', title: 'Tab: Select by Index', run: (args) => ws.selectTabIndex(asIndex(args)) },
    { id: 'view.splitRight', title: 'View: Split Right', run: () => ws.splitActive('row') },
    { id: 'view.splitDown', title: 'View: Split Down', run: () => ws.splitActive('col') },
    { id: 'view.closePane', title: 'View: Close Pane', run: () => ws.closeActivePane() },
    { id: 'view.singlePane', title: 'View: Single Pane', run: () => ws.singlePane() },
    { id: 'view.focusPane', title: 'View: Focus Pane by Index', run: (args) => ws.focusPaneIndex(asIndex(args)) },
    { id: 'palette.commands', title: 'Command Palette', run: () => ui.openPalette() },
    ...editorCommands.map((spec) => ({
      id: spec.id,
      title: `Edit: ${spec.title}`,
      when: 'editorFocus',
      run: () => {
        const view = ws.activeView()
        if (view) spec.run(view)
      },
    })),
  ])
}
```

`src/renderer/src/app/useKeymap.ts`:
```ts
import type { CommandRegistry } from '../commands/registry'
import { evaluateWhen, type WhenContext } from '../commands/when'
import { type CompiledBinding, resolveStroke } from '../keymap/bindings'
import { type KeyStroke, strokeFromEvent } from '../keymap/keys'

export const installKeymap = (
  target: Window,
  bindings: () => readonly CompiledBinding[],
  registry: CommandRegistry,
  getContext: () => WhenContext,
): (() => void) => {
  let pending: readonly KeyStroke[] = []

  const handler = (event: KeyboardEvent): void => {
    if (getContext()['paletteOpen'] === true) return

    const stroke = strokeFromEvent(event)
    if (!stroke) return

    if (stroke.key === 'escape' && pending.length > 0) {
      pending = []
      event.preventDefault()
      return
    }

    const ctx = getContext()
    const resolution = resolveStroke(bindings(), pending, stroke, (when) => evaluateWhen(when, ctx))

    if (resolution.kind === 'run') {
      event.preventDefault()
      event.stopPropagation()
      pending = []
      void registry.run(resolution.binding.command, resolution.binding.args)
    } else if (resolution.kind === 'pending') {
      event.preventDefault()
      event.stopPropagation()
      pending = [...pending, stroke]
    } else {
      pending = []
    }
  }

  target.addEventListener('keydown', handler, { capture: true })
  return () => target.removeEventListener('keydown', handler, { capture: true })
}
```

- [x] **Step 5: Implement the UI components**

`src/renderer/src/ui/editor/EditorHost.tsx`:
```tsx
import { EditorState } from '@codemirror/state'
import { createEffect, on, onCleanup, onMount } from 'solid-js'
import { createView } from '../../editor/createEditor'
import type { Workspace } from '../../app/workspace'
import type { PaneLeaf } from '../layout/paneTree'

type Props = { readonly ws: Workspace; readonly leaf: () => PaneLeaf }

const emptyState = (): EditorState => EditorState.create({ doc: '', extensions: [EditorState.readOnly.of(true)] })

export const EditorHost = (props: Props) => {
  let host!: HTMLDivElement

  onMount(() => {
    const view = createView(host, emptyState())
    props.ws.registerView(props.leaf().id, view)

    createEffect(
      on(
        () => {
          const leaf = props.leaf()
          const tab = leaf.active ? props.ws.state.tabs[leaf.active] : undefined
          return tab?.bufferId ?? null
        },
        (bufferId) => {
          const buffer = bufferId ? props.ws.getBuffer(bufferId) : null
          view.setState(buffer ? buffer.state : emptyState())
        },
      ),
    )

    onCleanup(() => {
      props.ws.unregisterView(props.leaf().id)
      view.destroy()
    })
  })

  return <div class="editor-host" ref={host} onMouseDown={() => props.ws.focusPane(props.leaf().id)} />
}
```

The effect is keyed on the active *buffer id* only — never on the buffer's `EditorState` — so keystrokes (and IME compositions) do not trigger `setState`.

`src/renderer/src/ui/tabs/TabStrip.tsx`:
```tsx
import { For } from 'solid-js'
import type { Workspace } from '../../app/workspace'
import type { PaneLeaf } from '../layout/paneTree'

type Props = { readonly ws: Workspace; readonly leaf: () => PaneLeaf }

export const TabStrip = (props: Props) => (
  <div class="tabs" role="tablist">
    <For each={props.leaf().tabs}>
      {(tabId) => {
        const meta = () => {
          const tab = props.ws.state.tabs[tabId]
          return tab ? props.ws.state.buffers[tab.bufferId] : undefined
        }
        return (
          <div
            class="tab"
            role="tab"
            classList={{ active: props.leaf().active === tabId, dirty: meta()?.dirty ?? false }}
            title={meta()?.path ?? 'untitled'}
            onMouseDown={(e) => {
              if (e.button === 1) void props.ws.closeTab(tabId)
              else props.ws.activateTab(props.leaf().id, tabId)
            }}
          >
            <span class="tab-title">{meta()?.title ?? ''}</span>
            <span class="tab-dirty">●</span>
            <button
              class="tab-close"
              aria-label="Close tab"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                void props.ws.closeTab(tabId)
              }}
            >
              ×
            </button>
          </div>
        )
      }}
    </For>
  </div>
)
```

`src/renderer/src/ui/layout/SplitGutter.tsx`:
```tsx
type Props = {
  readonly direction: 'row' | 'col'
  readonly onDrag: (deltaPx: number) => void
}

export const SplitGutter = (props: Props) => {
  const start = (e: MouseEvent): void => {
    e.preventDefault()
    let last = props.direction === 'row' ? e.clientX : e.clientY

    const move = (ev: MouseEvent): void => {
      const now = props.direction === 'row' ? ev.clientX : ev.clientY
      props.onDrag(now - last)
      last = now
    }
    const stop = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
    }

    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
  }

  return <div class="gutter" classList={{ row: props.direction === 'row', col: props.direction === 'col' }} onMouseDown={start} />
}
```

`src/renderer/src/ui/layout/PaneView.tsx`:
```tsx
import { For, Show } from 'solid-js'
import type { Workspace } from '../../app/workspace'
import { EditorHost } from '../editor/EditorHost'
import { TabStrip } from '../tabs/TabStrip'
import type { PaneLeaf, PaneNode, PaneSplit } from './paneTree'
import { SplitGutter } from './SplitGutter'

type Props = { readonly ws: Workspace; readonly node: () => PaneNode }

const LeafView = (props: { ws: Workspace; leaf: () => PaneLeaf }) => (
  <div class="pane" classList={{ active: props.ws.state.activePane === props.leaf().id }} data-pane-id={props.leaf().id}>
    <TabStrip ws={props.ws} leaf={props.leaf} />
    <EditorHost ws={props.ws} leaf={props.leaf} />
  </div>
)

const SplitView = (props: { ws: Workspace; split: () => PaneSplit }) => {
  let container!: HTMLDivElement

  const resize = (index: number, deltaPx: number): void => {
    const split = props.split()
    const total = split.direction === 'row' ? container.clientWidth : container.clientHeight
    if (total === 0) return
    const delta = deltaPx / total
    const sizes = split.sizes.map((s, i) => (i === index ? s + delta : i === index + 1 ? s - delta : s))
    if (sizes.every((s) => s > 0.05)) props.ws.resizeSplit(split.id, sizes)
  }

  return (
    <div class="split" classList={{ row: props.split().direction === 'row', col: props.split().direction === 'col' }} ref={container}>
      <For each={props.split().children}>
        {(child, index) => (
          <>
            <Show when={index() > 0}>
              <SplitGutter direction={props.split().direction} onDrag={(d) => resize(index() - 1, d)} />
            </Show>
            <div class="split-child" style={{ flex: `${props.split().sizes[index()] ?? 1} 1 0px` }}>
              <PaneView ws={props.ws} node={() => child} />
            </div>
          </>
        )}
      </For>
    </div>
  )
}

export const PaneView = (props: Props) => (
  <Show
    when={props.node().kind === 'split'}
    fallback={<LeafView ws={props.ws} leaf={() => props.node() as PaneLeaf} />}
  >
    <SplitView ws={props.ws} split={() => props.node() as PaneSplit} />
  </Show>
)
```

`<For each={props.split().children}>` keys children by object identity, so unchanged sibling leaves keep their `EditorHost` (and `EditorView`) across tree updates; `mapNode` returns the same object for untouched nodes.

`src/renderer/src/ui/statusbar/StatusBar.tsx`:
```tsx
import { encodingLabel, eolLabel } from '@shared/encoding'
import type { Workspace } from '../../app/workspace'
import { languageById } from '../../editor/lang'

export const StatusBar = (props: { ws: Workspace }) => {
  const meta = () => props.ws.activeBuffer()?.meta ?? null
  const activeMeta = () => {
    const leaf = props.ws.activeLeaf()
    const tab = leaf.active ? props.ws.state.tabs[leaf.active] : undefined
    return tab ? props.ws.state.buffers[tab.bufferId] : undefined
  }

  return (
    <div class="statusbar">
      <span data-testid="pos">Ln {props.ws.state.cursor.line}, Col {props.ws.state.cursor.col}</span>
      <span data-testid="encoding">{meta() ? encodingLabel(meta()!.encoding, meta()!.bom) : ''}</span>
      <span data-testid="eol">{meta() ? eolLabel(meta()!.eol) : ''}</span>
      <span data-testid="language">{activeMeta() ? languageById(activeMeta()!.languageId).name : ''}</span>
      <span class="grow" data-testid="path">{activeMeta()?.path ?? (activeMeta() ? 'untitled' : '')}</span>
      <span data-testid="status">{props.ws.state.status}</span>
    </div>
  )
}
```

`meta()` reads the non-reactive buffer; it re-evaluates because `activeMeta()` reads store fields in the same JSX. To make encoding/eol update after save, the status bar reads `props.ws.state.buffers[...]` (reactive) for the trigger and then the buffer for the values — this is what the two accessors above do.

- [x] **Step 6: App, test hooks, styles**

`src/renderer/src/App.tsx`:
```tsx
import { createSignal, onCleanup, onMount } from 'solid-js'
import { R } from '@mobily/ts-belt'
import { channels } from '@shared/channels'
import { whenContext } from './app/context'
import { registerAppCommands } from './app/registerCommands'
import { installKeymap } from './app/useKeymap'
import { createWorkspace } from './app/workspace'
import { createCommandRegistry } from './commands/registry'
import { invoke, on } from './ipc'
import { compileBindings } from './keymap/bindings'
import { defaultBindings } from './keymap/defaults'
import type { Platform } from './keymap/keys'
import { installTestHooks } from './testHooks'
import { PaneView } from './ui/layout/PaneView'
import { CommandPalette } from './ui/palette/CommandPalette'
import { StatusBar } from './ui/statusbar/StatusBar'

const platform = (): Platform => (navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'win')

export const App = () => {
  const [paletteOpen, setPaletteOpen] = createSignal(false)

  const ws = createWorkspace({
    confirmClose: async (title) => {
      const result = await invoke('dialog.confirmClose', { title })
      return R.match(result, (r) => r.choice, () => 'cancel' as const)
    },
  })

  const registry = createCommandRegistry(() => whenContext(ws, { paletteOpen: paletteOpen() }))
  registerAppCommands(registry, ws, { openPalette: () => setPaletteOpen(true) })

  const bindings = compileBindings(defaultBindings(platform()), platform())

  onMount(async () => {
    const uninstall = installKeymap(window, () => bindings, registry, () => whenContext(ws, { paletteOpen: paletteOpen() }))
    const offCommand = on('command.run', ({ id, args }) => void registry.run(id, args))
    onCleanup(() => {
      uninstall()
      offCommand()
    })

    requestAnimationFrame(() => window.moru.send(channels.perfFirstPaint, undefined))

    const bootstrap = await invoke('app.bootstrap', undefined)
    await R.match(
      bootstrap,
      async ({ paths, test }) => {
        if (test) installTestHooks(ws, registry, paletteOpen)
        for (const path of paths) await ws.openFile(path)
        if (paths.length === 0) ws.newUntitled()
        ws.activeView()?.focus()
      },
      async () => ws.newUntitled(),
    )
  })

  return (
    <div class="app">
      <div class="workspace">
        <PaneView ws={ws} node={() => ws.state.tree} />
      </div>
      <StatusBar ws={ws} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => {
          setPaletteOpen(false)
          ws.activeView()?.focus()
        }}
        registry={registry}
        bindings={bindings}
        platform={platform()}
      />
    </div>
  )
}
```

`CommandPalette` is created in Task 7; for this task create a stub `src/renderer/src/ui/palette/CommandPalette.tsx` that renders nothing:
```tsx
import type { Accessor } from 'solid-js'
import type { CommandRegistry } from '../../commands/registry'
import type { CompiledBinding } from '../../keymap/bindings'
import type { Platform } from '../../keymap/keys'

export type PaletteProps = {
  readonly open: Accessor<boolean>
  readonly onClose: () => void
  readonly registry: CommandRegistry
  readonly bindings: readonly CompiledBinding[]
  readonly platform: Platform
}

export const CommandPalette = (_props: PaletteProps) => null
```

`src/renderer/src/testHooks.ts`:
```ts
import type { Accessor } from 'solid-js'
import type { Workspace } from './app/workspace'
import type { CommandRegistry } from './commands/registry'
import type { FileMeta } from './editor/buffers'
import { leaves } from './ui/layout/paneTree'

export type MoruTestHooks = {
  doc(): string
  selections(): { from: number; to: number }[]
  composing(): boolean
  focus(): void
  setCursor(pos: number): void
  setWhitespace(on: boolean): void
  path(): string | null
  meta(): FileMeta | null
  saveAs(mode: 'normal' | 'overwrite'): Promise<void>
  tabs(): { paneId: string; active: boolean; tabs: { path: string | null; title: string; dirty: boolean; active: boolean }[] }[]
  runCommand(id: string, args?: unknown): Promise<boolean>
  openPath(path: string): Promise<boolean>
  paletteOpen(): boolean
}

declare global {
  interface Window {
    __moruTest?: MoruTestHooks
  }
}

export const installTestHooks = (ws: Workspace, registry: CommandRegistry, paletteOpen: Accessor<boolean>): void => {
  const view = () => {
    const v = ws.activeView()
    if (!v) throw new Error('no active editor view')
    return v
  }

  window.__moruTest = {
    doc: () => view().state.doc.toString(),
    selections: () => view().state.selection.ranges.map((r) => ({ from: r.from, to: r.to })),
    composing: () => view().composing,
    focus: () => view().focus(),
    setCursor: (pos) => view().dispatch({ selection: { anchor: pos } }),
    setWhitespace: () => undefined,
    path: () => ws.activeBuffer()?.meta?.path ?? null,
    meta: () => ws.activeBuffer()?.meta ?? null,
    saveAs: (mode) => ws.save(mode),
    tabs: () =>
      leaves(ws.state.tree).map((leaf) => ({
        paneId: leaf.id,
        active: leaf.id === ws.state.activePane,
        tabs: leaf.tabs.map((tabId) => {
          const tab = ws.state.tabs[tabId]
          const meta = tab ? ws.state.buffers[tab.bufferId] : undefined
          return { path: meta?.path ?? null, title: meta?.title ?? '', dirty: meta?.dirty ?? false, active: leaf.active === tabId }
        }),
      })),
    runCommand: (id, args) => registry.run(id, args),
    openPath: (path) => ws.openFile(path),
    paletteOpen,
  }
}
```

`setWhitespace` becomes a no-op here (the `[info]` IME test still passes because it only asserts the doc); M1c wires it to settings. Mark the `[info]` test's `setWhitespace` call as informational in the report.

Append to `src/renderer/src/style.css`:
```css
.workspace {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

.split {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.split.row { flex-direction: row; }
.split.col { flex-direction: column; }

.split-child {
  display: flex;
  min-width: 0;
  min-height: 0;
}

.gutter {
  flex: 0 0 4px;
  background: var(--bar);
}

.gutter.row { cursor: col-resize; }
.gutter.col { cursor: row-resize; }

.pane {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  border: 1px solid transparent;
}

.pane.active {
  border-color: #3d4450;
}

.tabs {
  display: flex;
  overflow-x: auto;
  background: var(--bar);
  flex: 0 0 auto;
  min-height: 28px;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  color: #9aa3ad;
  cursor: default;
  user-select: none;
  white-space: nowrap;
}

.tab.active {
  background: var(--bg);
  color: var(--fg);
}

.tab-dirty { display: none; color: #e6c07b; }
.tab.dirty .tab-dirty { display: inline; }

.tab-close {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0 2px;
}

.editor-host {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.statusbar .grow { flex: 1 1 auto; text-align: right; opacity: 0.7; }
```

Remove the `.toolbar` rules and the `.editor` rule from M0 if nothing uses them.

- [x] **Step 7: Run everything**

Run: `pnpm typecheck && pnpm test && pnpm build && pnpm exec playwright test`
Expected: all PASS, including the updated `file.spec.ts` / `roundtrip.spec.ts` and the M0 IME suite. Likely trip-ups: (a) `EditorHost` effect firing before `registerView` — register first (as written); (b) `focusChanged` reported with `hasFocus` false during `setState` — the workspace treats a blur as `editorFocused: false`, and the tab click handler calls `focusView` right after, which re-focuses; (c) `R.match` with async branches — both branches must return promises.

- [x] **Step 8: Commit**

```bash
git add -A src tests
git commit -m "feat(shell): workspace store with buffers, tab groups, split panes, Sublime keymap wiring, and status bar"
```

---

### Task 7: Command palette

**Files:**
- Rewrite: `src/renderer/src/ui/palette/CommandPalette.tsx`
- Modify: `src/renderer/src/style.css`
- Test: `tests/e2e/palette.spec.ts`

**Interfaces:**
- `CommandPalette(props: PaletteProps)` — overlay with `[data-testid="palette"]`, an `<input data-testid="palette-input">`, and a list of `[data-testid="palette-item"]` rows (title + key label). Filters `registry.available()` by fuzzy title match (fzf), ArrowUp/Down move, Enter runs the highlighted command **after** `onClose()`, Escape closes. Opening focuses the input and clears the query.

- [x] **Step 1: Write the failing E2E**

`tests/e2e/palette.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('palette opens with mod+shift+p, filters fuzzily, and runs the selected command', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs().length)).toBe(1)

  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+Shift+p`)
  await expect(page.getByTestId('palette')).toBeVisible()
  await expect(page.getByTestId('palette-input')).toBeFocused()

  await page.keyboard.type('spl rgt')
  await expect(page.getByTestId('palette-item').first()).toContainText('View: Split Right')

  await page.keyboard.press('Enter')
  await expect(page.getByTestId('palette')).toBeHidden()
  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs().length)).toBe(2)

  await app.close()
})

test('escape closes the palette and returns focus to the editor', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await page.evaluate(() => window.__moruTest!.focus())

  await page.evaluate(() => window.__moruTest!.runCommand('palette.commands'))
  await expect(page.getByTestId('palette')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette')).toBeHidden()
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('cm-content') ?? false)).toBe(true)

  await app.close()
})

test('editor-only commands are hidden while the editor is not focused', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await page.evaluate(() => window.__moruTest!.focus())

  await page.keyboard.press(`${mod}+Shift+p`)
  await page.keyboard.type('toggle comment')
  await expect(page.getByTestId('palette-item').first()).toContainText('Toggle Comment')

  await app.close()
})
```

The third test passes because the palette snapshots `registry.available()` at open time, when the editor still has focus.

- [x] **Step 2: Run to verify it fails**

Run: `pnpm build && pnpm exec playwright test tests/e2e/palette.spec.ts`
Expected: FAIL (palette not rendered).

- [x] **Step 3: Implement**

`src/renderer/src/ui/palette/CommandPalette.tsx`:
```tsx
import { Fzf } from 'fzf'
import { type Accessor, For, Show, createEffect, createMemo, createSignal, on } from 'solid-js'
import type { Command, CommandRegistry } from '../../commands/registry'
import type { CompiledBinding } from '../../keymap/bindings'
import { type Platform, formatKeys } from '../../keymap/keys'

export type PaletteProps = {
  readonly open: Accessor<boolean>
  readonly onClose: () => void
  readonly registry: CommandRegistry
  readonly bindings: readonly CompiledBinding[]
  readonly platform: Platform
}

type Item = { readonly command: Command; readonly keys: string }

const clamp = (n: number, max: number): number => Math.max(0, Math.min(n, max))

export const CommandPalette = (props: PaletteProps) => {
  const [query, setQuery] = createSignal('')
  const [index, setIndex] = createSignal(0)
  const [items, setItems] = createSignal<readonly Item[]>([])
  let input!: HTMLInputElement

  const keyLabel = (commandId: string): string => {
    const binding = props.bindings.find((b) => b.command === commandId)
    return binding ? formatKeys(binding.chord, props.platform) : ''
  }

  createEffect(
    on(props.open, (open) => {
      if (!open) return
      setQuery('')
      setIndex(0)
      setItems(
        [...props.registry.available()]
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((command) => ({ command, keys: keyLabel(command.id) })),
      )
      queueMicrotask(() => input.focus())
    }),
  )

  const fzf = createMemo(() => new Fzf(items(), { selector: (item) => item.command.title }))

  const matches = createMemo(() => (query().trim() === '' ? items() : fzf().find(query()).map((r) => r.item)))

  const run = (item: Item | undefined): void => {
    props.onClose()
    if (item) setTimeout(() => void props.registry.run(item.command.id), 0)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => clamp(i + 1, matches().length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => clamp(i - 1, matches().length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(matches()[index()])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      props.onClose()
    }
  }

  return (
    <Show when={props.open()}>
      <div class="palette-backdrop" onMouseDown={props.onClose}>
        <div class="palette" data-testid="palette" onMouseDown={(e) => e.stopPropagation()}>
          <input
            ref={input}
            data-testid="palette-input"
            class="palette-input"
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value)
              setIndex(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Command"
            spellcheck={false}
            autocomplete="off"
          />
          <div class="palette-list" role="listbox">
            <For each={matches().slice(0, 40)}>
              {(item, i) => (
                <div
                  class="palette-item"
                  data-testid="palette-item"
                  role="option"
                  classList={{ selected: i() === index() }}
                  onMouseEnter={() => setIndex(i())}
                  onMouseDown={() => run(item)}
                >
                  <span class="palette-title">{item.command.title}</span>
                  <span class="palette-keys">{item.keys}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  )
}
```

Append to `style.css`:
```css
.palette-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 10vh;
  background: rgba(0, 0, 0, 0.25);
  z-index: 100;
}

.palette {
  width: min(640px, 90vw);
  background: var(--bar);
  border: 1px solid #3d4450;
  border-radius: 6px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.palette-input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: none;
  outline: none;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 14px;
}

.palette-list { max-height: 50vh; overflow-y: auto; }

.palette-item {
  display: flex;
  justify-content: space-between;
  padding: 6px 12px;
  cursor: default;
}

.palette-item.selected { background: #3d4450; }
.palette-keys { opacity: 0.6; }
```

- [x] **Step 4: Run**

Run: `pnpm typecheck && pnpm build && pnpm exec playwright test tests/e2e/palette.spec.ts tests/e2e/keymap.spec.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/renderer/src/ui/palette src/renderer/src/style.css tests/e2e/palette.spec.ts
git commit -m "feat(palette): fuzzy command palette with key labels"
```

---

### Task 8: Native menu, close confirmation dialog

**Files:**
- Create: `src/main/menu.ts`
- Modify: `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/main/ipc/handlers.ts`, `src/main/index.ts`, `tests/unit/shared/ipc.test.ts`
- Test: `tests/e2e/close.spec.ts`, `tests/e2e/menu.spec.ts`

**Interfaces:**
- Channels: invoke `dialog.confirmClose` (`{ title: string }` → `{ choice: 'save' | 'dontSave' | 'cancel' }`), push `command.run` (`{ id: string; args?: unknown }`).
- `installMenu(): void` builds the application menu; every non-role item has `id` = command id and `click` → `pushToAll('command.run', { id })`.
- Test mode: `dialog.confirmClose` returns `process.env.MORU_TEST_CONFIRM ?? 'dontSave'`.

- [x] **Step 1: Write the failing tests**

Add to `tests/unit/shared/ipc.test.ts`:
```ts
  it('dialog.confirmClose and command.run have contracts', () => {
    expect(contracts['dialog.confirmClose'].response.safeParse({ ok: true, value: { choice: 'save' } }).success).toBe(true)
    expect(contracts['dialog.confirmClose'].response.safeParse({ ok: true, value: { choice: 'maybe' } }).success).toBe(false)
    expect(pushContracts['command.run'].safeParse({ id: 'file.save' }).success).toBe(true)
    expect(pushContracts['command.run'].safeParse({ id: 'tab.select', args: 2 }).success).toBe(true)
  })
```

`tests/e2e/close.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const dirtyFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-close-'))
  const path = join(dir, 'c.txt')
  writeFileSync(path, 'v1\n')
  return path
}

const edit = async (page: import('@playwright/test').Page) => {
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('x')
}

test('closing a dirty tab with dontSave discards the edit', async () => {
  const path = dirtyFile()
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path, MORU_TEST_CONFIRM: 'dontSave' })
  await edit(page)

  await page.evaluate(() => window.__moruTest!.runCommand('tab.close'))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs()[0]?.tabs.length)).toBe(0)
  expect(readFileSync(path, 'utf8')).toBe('v1\n')

  await app.close()
})

test('closing a dirty tab with save writes the file first', async () => {
  const path = dirtyFile()
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path, MORU_TEST_CONFIRM: 'save' })
  await edit(page)

  await page.evaluate(() => window.__moruTest!.runCommand('tab.close'))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs()[0]?.tabs.length)).toBe(0)
  expect(readFileSync(path, 'utf8')).toBe('xv1\n')

  await app.close()
})

test('cancel keeps the tab', async () => {
  const path = dirtyFile()
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path, MORU_TEST_CONFIRM: 'cancel' })
  await edit(page)

  await page.evaluate(() => window.__moruTest!.runCommand('tab.close'))
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => window.__moruTest!.tabs()[0]?.tabs.length)).toBe(1)

  await app.close()
})
```

`tests/e2e/menu.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')

test('menu items dispatch commands to the renderer', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs().length)).toBe(1)

  const clicked = await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('view.splitRight')
    item?.click()
    return item !== null && item !== undefined
  })
  expect(clicked).toBe(true)

  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs().length)).toBe(2)
  await app.close()
})
```

- [x] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/unit/shared/ipc.test.ts; pnpm build && pnpm exec playwright test tests/e2e/close.spec.ts tests/e2e/menu.spec.ts`
Expected: FAIL.

- [x] **Step 3: Implement**

`src/shared/channels.ts` — add `dialogConfirmClose: 'dialog.confirmClose'` and `commandRun: 'command.run'`; add `channels.commandRun` to `pushChannels`.

`src/shared/ipc.ts` — add:
```ts
export const CloseChoice = z.enum(['save', 'dontSave', 'cancel'])
export type CloseChoice = z.infer<typeof CloseChoice>
export const CommandRun = z.object({ id: z.string(), args: z.unknown().optional() })
export type CommandRun = z.infer<typeof CommandRun>
// contracts:
  'dialog.confirmClose': { request: z.object({ title: z.string() }), response: ipcResult(z.object({ choice: CloseChoice }), UnexpectedError) },
// pushContracts:
  'command.run': CommandRun,
```

`src/main/ipc/handlers.ts` — add:
```ts
  handle('dialog.confirmClose', async ({ title }) => {
    if (isTest) return ok({ choice: CloseChoice.parse(process.env['MORU_TEST_CONFIRM'] ?? 'dontSave') })

    const { response } = await dialog.showMessageBox({
      type: 'warning',
      message: `Save changes to ${title}?`,
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    })
    const choices: CloseChoice[] = ['save', 'dontSave', 'cancel']
    return ok({ choice: choices[response] ?? 'cancel' })
  })
```
(import `CloseChoice` from `@shared/ipc`).

`src/main/menu.ts`:
```ts
import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { pushToAll } from './ipc/push'

const command = (label: string, id: string, accelerator?: string): MenuItemConstructorOptions => ({
  id,
  label,
  accelerator,
  click: () => pushToAll('command.run', { id }),
})

export const installMenu = (): void => {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'quit' as const }] }] : []),
    {
      label: 'File',
      submenu: [
        command('New File', 'file.new', 'CmdOrCtrl+N'),
        command('Open…', 'file.open', 'CmdOrCtrl+O'),
        { type: 'separator' },
        command('Save', 'file.save', 'CmdOrCtrl+S'),
        command('Save As…', 'file.saveAs', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        command('Close Tab', 'tab.close', 'CmdOrCtrl+W'),
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        command('Command Palette…', 'palette.commands', 'CmdOrCtrl+Shift+P'),
        { type: 'separator' },
        command('Split Right', 'view.splitRight'),
        command('Split Down', 'view.splitDown'),
        command('Close Pane', 'view.closePane'),
        command('Single Pane', 'view.singlePane'),
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
```

Accelerators on `File` items duplicate the renderer keymap on purpose: the menu handles the key only when the window has no focused web contents (menu accelerators fire before the renderer sees the key on some platforms). To avoid double execution, do **not** set accelerators for commands the renderer keymap already handles — remove the `accelerator` arguments above and keep them only as display labels via `registerAccelerator: false`:

```ts
const command = (label: string, id: string, accelerator?: string): MenuItemConstructorOptions => ({
  id,
  label,
  accelerator,
  registerAccelerator: false,
  click: () => pushToAll('command.run', { id }),
})
```

`registerAccelerator: false` shows the shortcut in the menu without Electron intercepting the key.

`src/main/index.ts` — after `registerLogChannel()`: `installMenu()` (import from `./menu`).

- [x] **Step 4: Run everything**

Run: `pnpm typecheck && pnpm test && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [x] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "feat(shell): native application menu dispatching commands and close-tab confirmation"
```

---

### Task 9: Report

**Files:**
- Create: `docs/superpowers/reports/m1b-editing-shell.md`
- Modify: tick checkboxes in this plan

- [x] **Step 1: Run `pnpm check`, write the report with actual numbers**

```markdown
# M1b 편집 셸 보고서

- 실행일: <YYYY-MM-DD>
- 커밋: <sha>
- 검증: typecheck · 유닛 <n>/<n> · E2E <n>/<n>

## 결과
| 영역 | 테스트 | 결과 |
|---|---|---|
| 언어 레지스트리 (15 언어 + legacy shell) | unit | |
| 버퍼 모델 (dirty · markSaved · withLanguage) | unit | |
| pane 트리 (split/close/move/resize/sibling) | unit | |
| when 평가기 · 커맨드 레지스트리 | unit | |
| 키 파싱 · 코드 해석 · 충돌 검출 · ST3 기본 키맵 무충돌 | unit | |
| 탭: 시작 경로 → 탭, 전환 시 undo 유지, 닫기, 순환 | e2e | |
| 분할: 오른쪽/아래, 단일화, pane 닫기 | e2e | |
| 키맵: Cmd+/ · Cmd+Shift+D · Ctrl+Shift+K · Cmd+L, 포커스 없을 때 무동작 | e2e | |
| 팔레트: 열기·퍼지·실행·Esc 포커스 복귀 | e2e | |
| 닫기 확인: save / dontSave / cancel | e2e | |
| 메뉴 → command.run | e2e | |
| M0/M1a 회귀 | e2e | |

## 발견·결정
- <실행 중 발견한 것>

## M1c로 넘기는 것
상태바 클릭 메뉴(재해석·EOL·인덴트·Set Syntax) · 배너(충돌/lossy/readonly) · 테마 다크/라이트 · 설정 → Compartment(tabSize·wordWrap·lineNumbers·highlightWhitespace·font) + 핫리로드 구독 · dirty store 디바운스 쓰기 + 시작 시 복원 · 사용자 keymap.json 오버레이 · 탭 드래그.
```

- [x] **Step 2: Commit**

```bash
git add docs/superpowers
git commit -m "docs(m1b): add editing shell report"
```

---

## Self-Review Notes

- Spec coverage: §3.5 pane 모델 (Task 3, 6), §3.6 커맨드/`when` (Task 4), §5.6 키맵 기본값·플랫폼 `mod`·충돌 보고 함수 (Task 5; 사용자 `keymap.json` 로딩은 M1c), §5.2 멀티커서 커맨드 표 중 CM6 내장 항목 전부 (Task 4; `splitSelectionIntoLines`·`addCursorAbove/Below`·`skipOccurrence` 자작 커맨드는 M3), §8 M1 "탭 · 에디터 분할 · 커맨드 레지스트리+팔레트 · ST3 기본 키맵" (Tasks 6–8). 상태바·테마·설정 반영·크래시 복원·언어별 설정은 M1c.
- Type consistency: `Buffer`/`FileMeta`/`createBuffer`/`markSaved` (Task 2) used by Task 6; `PaneNode` ops (Task 3) used by Task 6 (`moveTab`, `closeLeaf`, `siblingLeaf`, `resizeSplit`); `CompiledBinding`/`resolveStroke` (Task 5) used by `useKeymap` (Task 6) and `CommandPalette` (Task 7); `CommandRegistry.available()` (Task 4) used by the palette; `CloseChoice` (Task 8) matches `Workspace` deps type in Task 6.
- Test-id contract kept for existing E2E: `pos`, `encoding`, `eol`, `status`, `path` remain on the status bar; `save` button is gone and tests use `runCommand('file.save')`.
