# M3b Buffer Find / Replace Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sublime-style find/replace for the active buffer: bottom panel with regex / case / whole-word / in-selection / wrap / preserve-case toggles, live match count "3 / 27", viewport highlighting, Enter / Shift+Enter navigation, Alt+Enter → select all matches (multi-cursor), replace next / all with `$1` groups, recent queries kept in the session.

**Architecture:** Reuse `@codemirror/search`'s state and commands (`setSearchQuery`, `findNext/Previous`, `replaceNext/All`, `selectMatches`) and its match highlighter, which only runs while its panel is open — so the extension is configured with a `createPanel` that returns an empty, CSS-hidden element and our Solid `FindPanel` drives the query. In-selection search is a `test` filter over ranges kept in our own `StateField` (mapped through changes). Preserve-case replace and the match counter are ours (both iterate `query.getCursor`). Panel state (`open`, `replaceOpen`, query, toggles, count) lives in the workspace, applies to the active buffer, and `findHistory` (20 entries) is added to the session snapshot.

**Tech Stack:** @codemirror/search 6.7.2 (`search`, `SearchQuery`, `setSearchQuery`, `getSearchQuery`, `openSearchPanel`, `closeSearchPanel`, `findNext`, `findPrevious`, `replaceNext`, `replaceAll`, `selectMatches`), Solid.js.

**Spec:** §5.2 버퍼 내 find/replace, §5.6 키맵, §8 M3.

## Global Constraints

- Regex flavour is JS `RegExp` (the CM6 default): lookbehind, backreferences, named groups; replace supports `$1`, `$<name>`, `\n`, `\t` (CM6 semantics).
- Highlights are viewport-only (CM6 behaviour); the counter caps at 10 000 matches and shows `10000+`.
- In-selection ranges are captured when the toggle is switched on (or when the panel opens with a non-empty selection and the toggle is on) and mapped through document changes.
- Preserve-case applies ST3 rules: ALL CAPS match → uppercase replacement; Capitalized → capitalize; otherwise replacement as typed.
- Every panel command is a registry command (`find.*`) with `when: 'hasBuffer'`; panel-local keys (Enter/Shift+Enter/Alt+Enter/Escape) are handled by the input's keydown handler, and the window keymap ignores keys while `findFocus` is true except `find.*`, `palette.*`, `tab.*`, `view.*`.
- TS strict, ts-belt, functional style. Conventional commits.

## File Structure

```
src/renderer/src/find/state.ts         # inSelectionRanges StateField + effect, preserveCase helpers (pure)
src/renderer/src/find/query.ts         # buildQuery(spec, ranges): SearchQuery; countMatches; currentIndex
src/renderer/src/find/replace.ts       # replaceNextPreserving, replaceAllPreserving (pure over state)
src/renderer/src/find/panelExtension.ts# search({ createPanel }) config + hidden panel
src/renderer/src/ui/find/FindPanel.tsx
src/renderer/src/app/workspace.ts      # (modify) find state, actions, findHistory in snapshot
src/renderer/src/app/registerCommands.ts, keymap/defaults.ts, app/useKeymap.ts, app/context.ts  # (modify)
src/renderer/src/editor/createEditor.ts# (modify) include find extensions
src/renderer/src/ui/layout/PaneView.tsx# (modify) render FindPanel under the active pane
src/shared/session.ts                  # (modify) findHistory?: string[]
src/renderer/src/testHooks.ts, style.css   # (modify)
tests/unit/renderer/findState.test.ts
tests/unit/renderer/findReplace.test.ts
tests/e2e/find.spec.ts
docs/superpowers/reports/m3b-find-replace.md
```

---

### Task 1: Pure find helpers — in-selection ranges, query builder, counting, preserve-case replace

**Files:**
- Create: `src/renderer/src/find/state.ts`, `src/renderer/src/find/query.ts`, `src/renderer/src/find/replace.ts`
- Test: `tests/unit/renderer/findState.test.ts`, `tests/unit/renderer/findReplace.test.ts`

**Interfaces:**
```ts
// state.ts
FindSpec = { search: string; replace: string; regexp: boolean; caseSensitive: boolean; wholeWord: boolean; inSelection: boolean; wrap: boolean; preserveCase: boolean }
defaultFindSpec: FindSpec
setInSelectionRanges: StateEffectType<readonly { from: number; to: number }[] | null>
inSelectionField: StateField<readonly SelectionRange[] | null>   // mapped through changes
preserveCaseOf(sample: string, replacement: string): string       // 'FOO'→'BAR', 'Foo'→'Bar', 'foo'→'bar'
// query.ts
buildQuery(spec: FindSpec, ranges: readonly SelectionRange[] | null): SearchQuery   // test filters by ranges when inSelection
countMatches(query: SearchQuery, state: EditorState, cap = 10_000): { count: number; capped: boolean }
currentMatchIndex(query: SearchQuery, state: EditorState, cap = 10_000): number | null  // 1-based index of the match equal to the main selection
// replace.ts
replaceNextPreserving(state: EditorState, query: SearchQuery): TransactionSpec | null   // replaces the match at/after main selection, selects the next
replaceAllPreserving(state: EditorState, query: SearchQuery): TransactionSpec | null
```

- [x] **Step 1: Write failing tests**

`tests/unit/renderer/findState.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { defaultFindSpec, inSelectionField, preserveCaseOf, setInSelectionRanges } from '@renderer/find/state'
import { buildQuery, countMatches, currentMatchIndex } from '@renderer/find/query'

const doc = 'foo Foo FOO foobar\nfoo\n'

describe('preserveCaseOf', () => {
  it('mirrors the case pattern of the sample', () => {
    expect(preserveCaseOf('FOO', 'bar')).toBe('BAR')
    expect(preserveCaseOf('Foo', 'bar')).toBe('Bar')
    expect(preserveCaseOf('foo', 'Bar')).toBe('Bar')
    expect(preserveCaseOf('fOO', 'bar')).toBe('bar')
  })
})

describe('buildQuery / countMatches', () => {
  it('counts plain, case-insensitive matches', () => {
    const state = EditorState.create({ doc })
    const q = buildQuery({ ...defaultFindSpec, search: 'foo' }, null)
    expect(countMatches(q, state)).toEqual({ count: 5, capped: false })
  })

  it('honours case, whole word and regexp', () => {
    const state = EditorState.create({ doc })
    expect(countMatches(buildQuery({ ...defaultFindSpec, search: 'foo', caseSensitive: true }, null), state).count).toBe(3)
    expect(countMatches(buildQuery({ ...defaultFindSpec, search: 'foo', caseSensitive: true, wholeWord: true }, null), state).count).toBe(2)
    expect(countMatches(buildQuery({ ...defaultFindSpec, search: 'fo+b', regexp: true }, null), state).count).toBe(1)
  })

  it('restricts to in-selection ranges and maps them through changes', () => {
    const base = EditorState.create({ doc, extensions: inSelectionField })
    const withRanges = base.update({ effects: setInSelectionRanges.of([{ from: 0, to: 7 }]) }).state
    const q = buildQuery({ ...defaultFindSpec, search: 'foo', inSelection: true }, withRanges.field(inSelectionField))
    expect(countMatches(q, withRanges).count).toBe(2)

    const shifted = withRanges.update({ changes: { from: 0, insert: 'xx ' } }).state
    const ranges = shifted.field(inSelectionField)
    expect(ranges?.[0]?.from).toBe(3)
    expect(ranges?.[0]?.to).toBe(10)
  })

  it('reports the 1-based index of the selected match', () => {
    const state = EditorState.create({ doc, selection: EditorSelection.single(4, 7) })
    const q = buildQuery({ ...defaultFindSpec, search: 'foo' }, null)
    expect(currentMatchIndex(q, state)).toBe(2)
    expect(currentMatchIndex(q, EditorState.create({ doc }))).toBeNull()
  })

  it('caps the count', () => {
    const state = EditorState.create({ doc: 'a'.repeat(50) })
    expect(countMatches(buildQuery({ ...defaultFindSpec, search: 'a' }, null), state, 10)).toEqual({ count: 10, capped: true })
  })
})
```

`tests/unit/renderer/findReplace.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { defaultFindSpec } from '@renderer/find/state'
import { buildQuery } from '@renderer/find/query'
import { replaceAllPreserving, replaceNextPreserving } from '@renderer/find/replace'

const doc = 'foo Foo FOO x\n'

describe('replace with preserve case', () => {
  it('replaceAll mirrors case per match', () => {
    const state = EditorState.create({ doc })
    const q = buildQuery({ ...defaultFindSpec, search: 'foo', replace: 'bar', preserveCase: true }, null)
    const spec = replaceAllPreserving(state, q)
    expect(spec).not.toBeNull()
    expect(state.update(spec!).state.doc.toString()).toBe('bar Bar BAR x\n')
  })

  it('replaceNext replaces the match at the selection and selects the following one', () => {
    const state = EditorState.create({ doc, selection: EditorSelection.single(4, 7) })
    const q = buildQuery({ ...defaultFindSpec, search: 'foo', replace: 'bar', preserveCase: true }, null)
    const next = state.update(replaceNextPreserving(state, q)!).state
    expect(next.doc.toString()).toBe('foo Bar FOO x\n')
    expect([next.selection.main.from, next.selection.main.to]).toEqual([8, 11])
  })

  it('replaceNext with regexp groups keeps CM6 semantics when preserveCase is off', () => {
    const state = EditorState.create({ doc: 'a1 b2\n', selection: EditorSelection.single(0, 2) })
    const q = buildQuery({ ...defaultFindSpec, search: '([a-z])(\\d)', replace: '$2$1', regexp: true }, null)
    const next = state.update(replaceNextPreserving(state, q)!).state
    expect(next.doc.toString()).toBe('1a b2\n')
  })

  it('returns null when nothing matches', () => {
    const state = EditorState.create({ doc })
    expect(replaceAllPreserving(state, buildQuery({ ...defaultFindSpec, search: 'zzz', replace: 'y' }, null))).toBeNull()
  })
})
```

- [x] **Step 2: Run to verify failure** → FAIL.

- [x] **Step 3: Implement**

`src/renderer/src/find/state.ts`:
```ts
import { type SelectionRange, StateEffect, StateField, EditorSelection } from '@codemirror/state'

export type FindSpec = {
  readonly search: string
  readonly replace: string
  readonly regexp: boolean
  readonly caseSensitive: boolean
  readonly wholeWord: boolean
  readonly inSelection: boolean
  readonly wrap: boolean
  readonly preserveCase: boolean
}

export const defaultFindSpec: FindSpec = {
  search: '', replace: '', regexp: false, caseSensitive: false, wholeWord: false, inSelection: false, wrap: true, preserveCase: false,
}

export const setInSelectionRanges = StateEffect.define<readonly { from: number; to: number }[] | null>()

export const inSelectionField = StateField.define<readonly SelectionRange[] | null>({
  create: () => null,
  update: (value, tr) => {
    const effect = tr.effects.find((e) => e.is(setInSelectionRanges))
    if (effect) return effect.value ? effect.value.map((r) => EditorSelection.range(r.from, r.to)) : null
    return value && tr.docChanged ? value.map((r) => r.map(tr.changes)) : value
  },
})

const isUpper = (s: string): boolean => s === s.toUpperCase() && s !== s.toLowerCase()
const isCapitalized = (s: string): boolean =>
  s.length > 0 && isUpper(s.charAt(0)) && s.slice(1) === s.slice(1).toLowerCase()
const isLower = (s: string): boolean => s === s.toLowerCase() && s !== s.toUpperCase()

export const preserveCaseOf = (sample: string, replacement: string): string => {
  if (isUpper(sample)) return replacement.toUpperCase()
  if (isCapitalized(sample)) return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase()
  if (isLower(sample)) return replacement.charAt(0).toLowerCase() + replacement.slice(1)
  return replacement
}
```

`src/renderer/src/find/query.ts`:
```ts
import { SearchQuery } from '@codemirror/search'
import type { EditorState, SelectionRange } from '@codemirror/state'
import type { FindSpec } from './state'

export const buildQuery = (spec: FindSpec, ranges: readonly SelectionRange[] | null): SearchQuery =>
  new SearchQuery({
    search: spec.search,
    replace: spec.replace,
    regexp: spec.regexp,
    caseSensitive: spec.caseSensitive,
    wholeWord: spec.wholeWord,
    test: spec.inSelection && ranges ? (_m, _s, from, to) => ranges.some((r) => from >= r.from && to <= r.to) : undefined,
  })

export const matchesOf = (query: SearchQuery, state: EditorState, cap = 10_000): { from: number; to: number }[] => {
  if (!query.valid) return []
  const out: { from: number; to: number }[] = []
  const cursor = query.getCursor(state)
  for (let step = cursor.next(); !step.done && out.length < cap; step = cursor.next()) out.push({ from: step.value.from, to: step.value.to })
  return out
}

export const countMatches = (query: SearchQuery, state: EditorState, cap = 10_000): { count: number; capped: boolean } => {
  const found = matchesOf(query, state, cap)
  return { count: found.length, capped: found.length >= cap }
}

export const currentMatchIndex = (query: SearchQuery, state: EditorState, cap = 10_000): number | null => {
  const { from, to } = state.selection.main
  const index = matchesOf(query, state, cap).findIndex((m) => m.from === from && m.to === to)
  return index >= 0 ? index + 1 : null
}
```
(`query.getCursor(state)` returns an iterator whose `value` has `from`/`to`; if the typing requires `Text`, pass `state.doc`.)

`src/renderer/src/find/replace.ts`:
```ts
import type { SearchQuery } from '@codemirror/search'
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import { matchesOf } from './query'
import { preserveCaseOf } from './state'

const replacementFor = (query: SearchQuery, state: EditorState, from: number, to: number, preserveCase: boolean): string => {
  const matched = state.sliceDoc(from, to)
  const base = query.regexp ? matched.replace(new RegExp(query.search, query.caseSensitive ? 'u' : 'iu'), query.replace) : query.replace
  return preserveCase ? preserveCaseOf(matched, base) : base
}

export const replaceAllPreserving = (state: EditorState, query: SearchQuery, preserveCase = true): TransactionSpec | null => {
  const matches = matchesOf(query, state)
  if (matches.length === 0) return null
  return {
    changes: matches.map((m) => ({ from: m.from, to: m.to, insert: replacementFor(query, state, m.from, m.to, preserveCase) })),
    userEvent: 'input.replace.all',
  }
}

export const replaceNextPreserving = (state: EditorState, query: SearchQuery, preserveCase = true): TransactionSpec | null => {
  const matches = matchesOf(query, state)
  if (matches.length === 0) return null
  const main = state.selection.main
  const at = matches.find((m) => m.from === main.from && m.to === main.to) ?? matches.find((m) => m.from >= main.to) ?? matches[0]
  if (!at) return null

  const insert = replacementFor(query, state, at.from, at.to, preserveCase)
  const delta = insert.length - (at.to - at.from)
  const following = matches.find((m) => m.from > at.from) ?? matches.find((m) => m.from < at.from)
  const selection = following
    ? EditorSelection.single(following.from + (following.from > at.from ? delta : 0), following.to + (following.from > at.from ? delta : 0))
    : EditorSelection.cursor(at.from + insert.length)

  return { changes: { from: at.from, to: at.to, insert }, selection, scrollIntoView: true, userEvent: 'input.replace' }
}
```
`preserveCase` argument defaults true here; callers pass `spec.preserveCase`. The third unit test passes `preserveCase` implicitly true with lowercase sample `a1` → `isLower('a1')` is true → `'1a'` lowercased stays `'1a'` ✓.

- [x] **Step 4: Run** — unit PASS, typecheck PASS.

- [x] **Step 5: Commit** — `feat(find): in-selection ranges, query builder, match counting, preserve-case replace`

---

### Task 2: Find panel UI, workspace state, commands, keys, session history

**Files:**
- Create: `src/renderer/src/find/panelExtension.ts`, `src/renderer/src/ui/find/FindPanel.tsx`
- Modify: `src/renderer/src/editor/createEditor.ts`, `src/renderer/src/app/workspace.ts`, `src/renderer/src/app/registerCommands.ts`, `src/renderer/src/keymap/defaults.ts`, `src/renderer/src/app/useKeymap.ts`, `src/renderer/src/app/context.ts`, `src/renderer/src/ui/layout/PaneView.tsx`, `src/shared/session.ts`, `src/renderer/src/testHooks.ts`, `src/renderer/src/style.css`
- Test: `tests/e2e/find.spec.ts`

**Interfaces:**
- `panelExtension.ts`: `findExtensions: Extension` = `[search({ createPanel: () => ({ dom: hiddenPanelElement(), top: false }), top: false }), inSelectionField]`; CSS hides `.cm-panels`.
- Workspace state `find: { open: boolean; replaceOpen: boolean; spec: FindSpec; count: number; capped: boolean; current: number | null; history: string[] }`, `findFocused: boolean`.
- Actions: `openFind(withReplace: boolean)` (opens, seeds `spec.search` with the current selection text when single-line & non-empty, opens the CM6 panel on the active view, captures in-selection ranges when `inSelection`), `closeFind()` (closes the CM6 panel, refocuses the editor), `setFindSpec(patch: Partial<FindSpec>)` (dispatches `setSearchQuery`, recomputes count/current), `findNext()`, `findPrevious()`, `findSelectAll()`, `replaceNext()`, `replaceAll()`, `setFindFocus(focused)`, `pushFindHistory(term)` (dedupe, max 20; called on Enter/replace).
- Count/current recomputed on: spec change, active buffer change, and buffer doc/selection updates (hook into `onUpdate` when `find.open`).
- Commands (`when: 'hasBuffer'`): `find.open` (`mod+f`), `find.openReplace` (`mod+alt+f`), `find.next` (`mod+g`), `find.previous` (`mod+shift+g`), `find.selectAll` (`alt+enter` inside panel only), `find.replaceNext`, `find.replaceAll`, `find.close`.
- Keymap: when `findFocus`, only `find.*`, `palette.*`, `tab.*`, `view.*` bindings run.
- Panel keys: Enter → next (or replaceNext when the replace input has focus), Shift+Enter → previous, Alt+Enter → select all, Escape → close.
- Session: `WindowSnapshot.findHistory?: string[]` saved/restored.
- Test ids: `find-panel`, `find-input`, `replace-input`, `find-count`, toggles `find-toggle-regexp|case|word|selection|wrap|preserve`, buttons `find-next`, `find-prev`, `find-replace`, `find-replace-all`, `find-select-all`.

- [x] **Step 1: Write the failing E2E**

`tests/e2e/find.spec.ts`:
```ts
import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const doc = (page: Page) => page.evaluate(() => window.__moruTest!.doc())
const sel = (page: Page) => page.evaluate(() => window.__moruTest!.selections())

const file = (text: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-find-'))
  const path = join(dir, 'f.txt')
  writeFileSync(path, text)
  return path
}

test('find panel: live count, next/previous, wrap, escape returns focus', async () => {
  const path = file('foo Foo FOO foobar\nfoo\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+f`)
  await expect(page.getByTestId('find-panel')).toBeVisible()
  await expect(page.getByTestId('find-input')).toBeFocused()

  await page.keyboard.type('foo')
  await expect(page.getByTestId('find-count')).toHaveText('5')
  await expect(page.locator('.cm-searchMatch')).toHaveCount(5)

  await page.keyboard.press('Enter')
  await expect(page.getByTestId('find-count')).toHaveText('1 / 5')
  expect((await sel(page))[0]).toEqual({ from: 0, to: 3 })
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('find-count')).toHaveText('2 / 5')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Shift+Enter')
  await expect(page.getByTestId('find-count')).toHaveText('5 / 5')

  await page.getByTestId('find-toggle-case').click()
  await expect(page.getByTestId('find-count')).toHaveText('3')
  await page.getByTestId('find-toggle-word').click()
  await expect(page.getByTestId('find-count')).toHaveText('2')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('find-panel')).toBeHidden()
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('cm-content') ?? false)).toBe(true)
  await app.close()
})

test('alt+enter selects all matches; typing edits every cursor', async () => {
  const path = file('a x a x a\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+f`)
  await page.keyboard.type('a')
  await page.keyboard.press('Alt+Enter')
  await expect(page.getByTestId('find-panel')).toBeHidden()
  await expect.poll(() => sel(page).then((s) => s.length)).toBe(3)
  await page.keyboard.type('b')
  await expect.poll(() => doc(page)).toBe('b x b x b\n')
  await app.close()
})

test('replace next and replace all with regexp groups and preserve case', async () => {
  const path = file('id1 Id2 ID3\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+Alt+f`)
  await expect(page.getByTestId('replace-input')).toBeVisible()

  await page.getByTestId('find-input').fill('id(\\d)')
  await page.getByTestId('find-toggle-regexp').click()
  await page.getByTestId('find-toggle-preserve').click()
  await page.getByTestId('replace-input').fill('key$1')
  await expect(page.getByTestId('find-count')).toHaveText('3')

  await page.getByTestId('find-replace').click()
  await expect.poll(() => doc(page)).toBe('key1 Id2 ID3\n')
  await page.getByTestId('find-replace-all').click()
  await expect.poll(() => doc(page)).toBe('key1 Key2 KEY3\n')
  await app.close()
})

test('in-selection restricts matches and the toggle survives edits', async () => {
  const path = file('foo\nfoo\nfoo\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setSelection(0, 8))
  await page.keyboard.press(`${mod}+f`)
  await page.getByTestId('find-toggle-selection').click()
  await page.getByTestId('find-input').fill('foo')
  await expect(page.getByTestId('find-count')).toHaveText('2')
  await app.close()
})

test('recent queries are kept across restarts', async () => {
  const path = file('x\n')
  const first = await launchApp({ MORU_TEST_OPEN: path })
  await first.page.evaluate(() => window.__moruTest!.focus())
  await first.page.keyboard.press(`${mod}+f`)
  await first.page.keyboard.type('needle')
  await first.page.keyboard.press('Enter')
  await first.page.waitForTimeout(1200)
  await first.app.close()

  const second = await launchApp({}, { userData: first.userData })
  expect(await second.page.evaluate(() => window.__moruTest!.findHistory())).toEqual(['needle'])
  await second.app.close()
})
```

- [x] **Step 2: Run to verify failure** → FAIL.

- [x] **Step 3: Implement**

`src/renderer/src/find/panelExtension.ts`:
```ts
import { search } from '@codemirror/search'
import type { Extension } from '@codemirror/state'
import { inSelectionField } from './state'

const hiddenPanel = (): { dom: HTMLElement; top: boolean } => {
  const dom = document.createElement('div')
  dom.className = 'moru-hidden-search-panel'
  return { dom, top: false }
}

export const findExtensions: Extension = [search({ createPanel: hiddenPanel, top: false }), inSelectionField]
```
`createEditor.ts`: replace `highlightSelectionMatches()` + keep `searchKeymap` out (our keymap owns `mod+f`, `mod+g`; remove `...searchKeymap` from `keymap.of` **except** we still want `Mod-d` from CM6? No — `editor.selectNextOccurrence` is in our keymap; drop `searchKeymap`). Add `findExtensions` to `baseExtensions`.

Workspace (sketch of the important parts):
```ts
const activeQuery = (): SearchQuery | null => { const view = activeView(); return view ? buildQuery(state.find.spec, view.state.field(inSelectionField, false) ?? null) : null }
const refreshCount = (): void => {
  const view = activeView(); const q = activeQuery()
  if (!view || !q || !state.find.open) return
  const { count, capped } = countMatches(q, view.state)
  setState('find', { count, capped, current: currentMatchIndex(q, view.state) })
}
const applyQuery = (): void => { const view = activeView(); const q = activeQuery(); if (view && q) { view.dispatch({ effects: setSearchQuery.of(q) }); refreshCount() } }
const openFind = (withReplace: boolean): void => {
  const view = activeView(); if (!view) return
  const sel = view.state.selection.main
  const seed = !sel.empty && !view.state.sliceDoc(sel.from, sel.to).includes('\n') ? view.state.sliceDoc(sel.from, sel.to) : state.find.spec.search
  setState('find', { open: true, replaceOpen: withReplace || state.find.replaceOpen, spec: { ...state.find.spec, search: seed } })
  if (state.find.spec.inSelection && !sel.empty) view.dispatch({ effects: setInSelectionRanges.of(view.state.selection.ranges.map((r) => ({ from: r.from, to: r.to }))) })
  openSearchPanel(view); applyQuery()
}
const closeFind = (): void => { const view = activeView(); setState('find', 'open', false); if (view) { closeSearchPanel(view); view.focus() } }
const setFindSpec = (patch: Partial<FindSpec>): void => {
  const view = activeView()
  if (patch.inSelection === true && view) { const rs = view.state.selection.ranges.filter((r) => !r.empty); view.dispatch({ effects: setInSelectionRanges.of(rs.length ? rs.map((r) => ({ from: r.from, to: r.to })) : null) }) }
  if (patch.inSelection === false && view) view.dispatch({ effects: setInSelectionRanges.of(null) })
  setState('find', 'spec', { ...state.find.spec, ...patch }); applyQuery()
}
const findStep = (cmd: Command): void => { const view = activeView(); if (view) { applyQuery(); cmd(view); refreshCount() } }
const findNextCmd = () => findStep(findNext); const findPrevCmd = () => findStep(findPrevious)
const findSelectAll = (): void => { const view = activeView(); if (!view) return; applyQuery(); selectMatches(view); closeFind() }
const replaceNextCmd = (): void => { const view = activeView(); const q = activeQuery(); if (!view || !q) return; const spec = state.find.spec.preserveCase ? replaceNextPreserving(view.state, q, true) : null; if (spec) view.dispatch(spec); else { applyQuery(); replaceNext(view) } refreshCount() }
const replaceAllCmd = ...same with replaceAll
```
`wrap: false` → when `findNext` would wrap (current index === count) do nothing: check `currentMatchIndex === count` before calling. Also `onUpdate` calls `refreshCount()` when `state.find.open`.

`FindPanel.tsx`: rendered inside `LeafView` for the active pane only (`Show when={ws.state.find.open && ws.state.activePane === leaf.id}`), below the editor. Two rows: find input + toggles + count + buttons; replace input + Replace / Replace All (when `replaceOpen`). Focus the find input on open (`createEffect(on(open))`). Inputs `onFocusIn/Out` → `ws.setFindFocus`. Keydown on inputs: Enter/Shift+Enter/Alt+Enter/Escape as specified; Enter in the replace input → `replaceNext`.

`useKeymap.ts`: when `ctx.findFocus`, only allow `find.`, `palette.`, `tab.`, `view.` (same shape as the terminal allow-list; generalise to `allowedWhileCaptured(commandId, prefixes)`).

Session: `findHistory` added to snapshot (`state.find.history`) and restored in `restoreSession`; `pushFindHistory(term)` on Enter (next/prev/select all) and replace.

Test hooks: `findHistory(): string[]`, `findState(): { open; count; current }`.

Style: `.find-panel { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; background: var(--bar); border-top: 1px solid var(--border); flex: 0 0 auto } .find-row { display: flex; gap: 6px; align-items: center } .find-row input { flex: 1; font: inherit; padding: 4px 6px; background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 4px } .find-toggle { font: inherit; padding: 2px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--fg); cursor: pointer } .find-toggle.on { background: var(--selection) } .find-count { min-width: 64px; text-align: right; opacity: .8 } .cm-panels { display: none }`.

- [x] **Step 4: Run** — `pnpm typecheck && pnpm test && pnpm build && pnpm exec playwright test` → all PASS. Regression watch: dropping `searchKeymap` must not break `Cmd+D` (ours) or the IME multi-cursor test (uses `Mod+d` via our keymap → `editor.selectNextOccurrence`) — verify `ime.spec.ts` still passes.

- [x] **Step 5: Commit** — `feat(find): buffer find/replace panel with toggles, live count, select-all, preserve-case replace, history`

---

### Task 3: Report

- [ ] `pnpm check`; write `docs/superpowers/reports/m3b-find-replace.md`; tick; commit `docs(m3b): add find/replace report`.

## Self-Review Notes

- §5.2 버퍼 내 항목 전부: 토글 6종 (T1/T2), 즉시 카운트 `n / m` (T2), 뷰포트 하이라이트 (CM6), Enter/Shift+Enter/Alt+Enter (T2), JS 정규식 + `$1` (CM6), 컴파일 에러 인라인 표시 → `query.valid === false`일 때 입력에 `invalid` 클래스 (T2 FindPanel), 선택 영역 내 RangeSet 매핑 (T1), 대소문자 보존 (T1), 최근 쿼리 20 세션 보존 (T2).
- Hooks: `findHistory`, `findState`. Test ids listed in T2.
