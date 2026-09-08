# M3c Goto Anything Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sublime's Cmd+P: fuzzy file search over the project (ripgrep file list + fzf), `:line[:col]`, `@symbol` (Lezer tree), `#word`, combined `file@sym` / `file:line`, transient preview tab while arrowing, MRU when the query is empty, and the `< 30 ms` query budget over 50k paths.

**Architecture:** Main `index/service` builds the file list with `rg --files` under the project root, keeps an `Fzf` instance in memory, answers `index.query` synchronously, and rebuilds (debounced) when the root watcher reports create/delete events. The renderer's `CommandPalette` becomes a generic `Palette` with two modes; goto mode parses the prefix, asks main for file matches (debounced 30 ms), computes symbols/words locally from the active `EditorState`, and drives `previewFile` / `commitPreview` / `cancelPreview` on the workspace. Preview tabs are ordinary buffer tabs flagged `preview: true`; a new preview replaces the old one, Enter commits, Escape closes and restores the previously active tab.

**Tech Stack:** @vscode/ripgrep 1.18.0 (`rgPath`), fzf 0.5.2 (main), @codemirror/language `syntaxTree`, Solid.js.

**Spec:** §5.3 Goto Anything / 커맨드 팔레트, §3.4 `index`, §1.5 응답 예산 (< 30 ms), §8 M3 수용 기준 (Cmd+P < 30 ms).

## Global Constraints

- Index paths are stored relative to the root for matching and display (NFC-normalized), absolute for opening; `.git` and `node_modules` are excluded; `.gitignore` is respected (rg default).
- 200k files cap: the list is truncated and `index.build` reports `truncated: true`; the palette shows a hint.
- Query budget: `index.query` over 50k synthetic paths must answer in < 30 ms (unit perf test, generous CI margin ×3).
- Preview tabs never persist (session snapshot skips `preview: true` tabs) and never write the dirty store.
- `@symbol` uses per-language node rules with a generic fallback; markdown headings always work.
- Palette input keys (Up/Down/Enter/Escape/Tab) are handled by the palette; the window keymap stays disabled while the palette is open (existing `paletteOpen` context).
- TS strict, ts-belt, functional style. Conventional commits.

## File Structure

```
src/main/index/list.ts                 # listFiles(root, rgPath, cap) via rg --files -0
src/main/index/service.ts              # createIndexService({ rgPath, subscribe, push }) build/query/dispose
src/shared/channels.ts, ipc.ts         # (modify) index.build, index.query, index.changed
src/main/ipc/handlers.ts, index.ts     # (modify)
src/renderer/src/goto/parse.ts         # parseGotoQuery(text) → { file, symbol?, line?, col?, word?, mode }
src/renderer/src/goto/symbols.ts       # symbolsOf(state, languageId), wordsOf(state)
src/renderer/src/app/workspace.ts      # (modify) preview tabs, mru, gotoLine(line, col), jumpTo(pos)
src/renderer/src/ui/palette/CommandPalette.tsx → Palette.tsx (rename) with modes
src/renderer/src/app/registerCommands.ts, keymap/defaults.ts, App.tsx, testHooks.ts, ui/tabs/TabStrip.tsx, style.css, shared/session.ts  # (modify)
tests/unit/main/indexList.test.ts
tests/unit/main/indexService.test.ts   # incl. 50k perf
tests/unit/renderer/gotoParse.test.ts
tests/unit/renderer/symbols.test.ts
tests/e2e/goto.spec.ts
docs/superpowers/reports/m3c-goto-anything.md
```

---

### Task 1: Main file index service

**Files:**
- Create: `src/main/index/list.ts`, `src/main/index/service.ts`
- Modify: `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/main/ipc/handlers.ts`, `src/main/index.ts`, `tests/unit/shared/ipc.test.ts`
- Test: `tests/unit/main/indexList.test.ts`, `tests/unit/main/indexService.test.ts`

**Interfaces:**
- `listFiles(root: string, rgPath: string, cap = 200_000): Promise<{ files: string[]; truncated: boolean }>` — spawns `rg --files --hidden --glob !.git/** --glob !node_modules/** -0` with `cwd: root`, splits on NUL, returns **relative** paths (as printed by rg with `cwd`), NFC-normalized, sorted.
- `createIndexService({ rgPath, subscribe, push })` → `{ build(root): Promise<{ files: number; truncated: boolean }>; query(text, limit): IndexItem[]; root(): string | null; dispose(): Promise<void> }` where `IndexItem = { rel: string; path: string; positions: number[]; score: number }`. Empty query → first `limit` entries. Watches the root (parcel) and rebuilds 500 ms after the last create/delete, pushing `index.changed { files }`.
- Contracts: `index.build { root }` → `{ files: number; truncated: boolean }`; `index.query { text, limit }` → `{ items: IndexItem[] }`; push `index.changed { files }`.

- [ ] **Step 1: Write failing tests**

`tests/unit/main/indexList.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rgPath } from '@vscode/ripgrep'
import { listFiles } from '../../../src/main/index/list'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'moru-index-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('listFiles', () => {
  it('lists files relative to the root, skipping .git and node_modules, honouring .gitignore', async () => {
    await mkdir(join(dir, 'src'))
    await mkdir(join(dir, '.git'))
    await mkdir(join(dir, 'node_modules', 'x'), { recursive: true })
    await mkdir(join(dir, 'dist'))
    await writeFile(join(dir, 'src', 'a.ts'), '')
    await writeFile(join(dir, 'b.md'), '')
    await writeFile(join(dir, '.git', 'HEAD'), '')
    await writeFile(join(dir, 'node_modules', 'x', 'i.js'), '')
    await writeFile(join(dir, 'dist', 'out.js'), '')
    await writeFile(join(dir, '.gitignore'), 'dist/\n')
    await writeFile(join(dir, '한글.txt'), '')

    const { files, truncated } = await listFiles(dir, rgPath)
    expect(truncated).toBe(false)
    expect(files).toEqual(['.gitignore', 'b.md', 'src/a.ts', '한글.txt'.normalize('NFC')])
  })

  it('truncates at the cap', async () => {
    for (let i = 0; i < 5; i += 1) await writeFile(join(dir, `f${i}.txt`), '')
    const { files, truncated } = await listFiles(dir, rgPath, 3)
    expect(files.length).toBe(3)
    expect(truncated).toBe(true)
  })
})
```

`tests/unit/main/indexService.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createMatcher } from '../../../src/main/index/service'

describe('index matcher', () => {
  it('ranks basename matches and returns positions', () => {
    const m = createMatcher(['src/app/workspace.ts', 'src/ui/tabs/TabStrip.tsx', 'docs/plan.md'], '/root')
    const items = m.query('wksp', 10)
    expect(items[0]?.rel).toBe('src/app/workspace.ts')
    expect(items[0]?.path).toBe('/root/src/app/workspace.ts')
    expect(items[0]?.positions.length).toBe(4)
    expect(m.query('', 2).map((i) => i.rel)).toEqual(['src/app/workspace.ts', 'src/ui/tabs/TabStrip.tsx'])
  })

  it('answers a 50k-path query under budget', () => {
    const paths = Array.from({ length: 50_000 }, (_, i) => `pkg${i % 97}/module${Math.floor(i / 97)}/file${i}.ts`)
    const m = createMatcher(paths, '/root')
    const started = performance.now()
    const items = m.query('mod12fil', 50)
    const elapsed = performance.now() - started
    expect(items.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(90)
  })
})
```
(`createMatcher(rel: string[], root)` is the pure core the service wraps; the perf assertion is 3× the spec budget to tolerate CI.)

Add to `tests/unit/shared/ipc.test.ts`:
```ts
  it('index contracts', () => {
    expect(contracts['index.build'].request.safeParse({ root: '/p' }).success).toBe(true)
    expect(contracts['index.query'].response.safeParse({ ok: true, value: { items: [{ rel: 'a', path: '/p/a', positions: [0], score: 1 }] } }).success).toBe(true)
    expect(pushContracts['index.changed'].safeParse({ files: 3 }).success).toBe(true)
  })
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement**

`src/main/index/list.ts`:
```ts
import { execFile } from 'node:child_process'

export const listFiles = (root: string, rgPath: string, cap = 200_000): Promise<{ files: string[]; truncated: boolean }> =>
  new Promise((resolve, reject) => {
    const args = ['--files', '--hidden', '--glob', '!.git/**', '--glob', '!node_modules/**', '-0']
    execFile(rgPath, args, { cwd: root, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      if (error && (error as { code?: number }).code !== 1) return reject(error)
      const all = String(stdout).split('\0').filter((p) => p.length > 0).map((p) => p.normalize('NFC')).sort()
      resolve({ files: all.slice(0, cap), truncated: all.length > cap })
    })
  })
```
(rg exits 1 when no files are found — not an error.)

`src/main/index/service.ts`:
```ts
import { join } from 'node:path'
import type { AsyncSubscription, Event, Options } from '@parcel/watcher'
import { Fzf } from 'fzf'
import type { PushChannel, PushPayload } from '@shared/ipc'
import { listFiles } from './list'

export type IndexItem = { readonly rel: string; readonly path: string; readonly positions: number[]; readonly score: number }

export type Matcher = { readonly query: (text: string, limit: number) => IndexItem[]; readonly size: number }

export const createMatcher = (rel: readonly string[], root: string): Matcher => {
  const fzf = new Fzf(rel as string[], { selector: (s) => s, limit: 200, casing: 'smart-case' })
  return {
    size: rel.length,
    query: (text, limit) =>
      text.trim() === ''
        ? rel.slice(0, limit).map((r) => ({ rel: r, path: join(root, r), positions: [], score: 0 }))
        : fzf.find(text).slice(0, limit).map((m) => ({ rel: m.item, path: join(root, m.item), positions: [...m.positions].sort((a, b) => a - b), score: m.score })),
  }
}

type Subscribe = (dir: string, cb: (err: Error | null, events: Event[]) => void, opts?: Options) => Promise<AsyncSubscription>
type Push = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void
type Deps = { readonly rgPath: string; readonly subscribe: Subscribe; readonly push: Push; readonly debounceMs?: number }

export type IndexService = {
  readonly build: (root: string) => Promise<{ files: number; truncated: boolean }>
  readonly query: (text: string, limit: number) => IndexItem[]
  readonly root: () => string | null
  readonly dispose: () => Promise<void>
}

export const createIndexService = ({ rgPath, subscribe, push, debounceMs = 500 }: Deps): IndexService => {
  let root: string | null = null
  let matcher: Matcher | null = null
  let subscription: AsyncSubscription | null = null
  let timer: NodeJS.Timeout | null = null

  const rebuild = async (): Promise<{ files: number; truncated: boolean }> => {
    if (!root) return { files: 0, truncated: false }
    const { files, truncated } = await listFiles(root, rgPath)
    matcher = createMatcher(files, root)
    return { files: files.length, truncated }
  }

  const scheduleRebuild = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void rebuild().then((r) => push('index.changed', { files: r.files })), debounceMs)
  }

  const build = async (nextRoot: string): Promise<{ files: number; truncated: boolean }> => {
    if (subscription) await subscription.unsubscribe()
    root = nextRoot
    subscription = await subscribe(nextRoot, (err, events) => {
      if (!err && events.some((e) => e.type !== 'update')) scheduleRebuild()
    }, { ignore: ['**/node_modules/**', '**/.git/**'] })
    return rebuild()
  }

  return {
    build,
    query: (text, limit) => matcher?.query(text, limit) ?? [],
    root: () => root,
    dispose: async () => {
      if (timer) clearTimeout(timer)
      await subscription?.unsubscribe()
      subscription = null
    },
  }
}
```

Contracts: `IndexItem = z.object({ rel, path, positions: z.array(z.number().int()), score: z.number() })`; `index.build { root }` → `{ files: z.number().int(), truncated: z.boolean() }`; `index.query { text, limit }` → `{ items: z.array(IndexItem) }`; push `index.changed { files }`. Handlers: `HandlerDeps.index`, `handle('index.build', ({ root }) => index.build(root).then(ok))`, `handle('index.query', async ({ text, limit }) => ok({ items: index.query(text, limit) }))`. `index.ts`: `createIndexService({ rgPath, subscribe: watcher.subscribe, push: pushToAll })`, dispose on quit.

- [ ] **Step 4: Run** — unit PASS (perf test prints elapsed), typecheck PASS, build + smoke PASS.

- [ ] **Step 5: Commit** — `feat(index): ripgrep file list with fzf matcher and watcher-driven rebuild`

---

### Task 2: Query parsing, symbols, words, preview tabs, MRU

**Files:**
- Create: `src/renderer/src/goto/parse.ts`, `src/renderer/src/goto/symbols.ts`
- Modify: `src/renderer/src/app/workspace.ts`, `src/renderer/src/ui/tabs/TabStrip.tsx`, `src/shared/session.ts`
- Test: `tests/unit/renderer/gotoParse.test.ts`, `tests/unit/renderer/symbols.test.ts`

**Interfaces:**
```ts
// parse.ts
GotoQuery = { mode: 'files' | 'symbols' | 'lines' | 'words'; file: string; symbol: string | null; line: number | null; col: number | null; word: string | null }
parseGotoQuery(text: string): GotoQuery
// examples: 'wksp' → files; '@render' → symbols; ':12' → lines; ':12:5'; '#todo' → words; 'wksp@render' → files+symbol; 'wksp:12' → files+line
// symbols.ts
Symbol = { name: string; from: number; kind: string }
symbolsOf(state: EditorState, languageId: string): Symbol[]   // ensureSyntaxTree(state, doc.length, 200) then iterate
wordsOf(state: EditorState, limit = 5000): { word: string; from: number }[]   // unique \p{L}[\p{L}\p{N}_]{2,} in first-occurrence order
```
Workspace: `Tab` buffer variant gains `preview?: boolean`; `previewFile(path): Promise<void>` (opens via `openFile`, marks the tab preview; closes the previous preview tab if different; remembers `previewOrigin = { paneId, tabId }` of the tab active before the first preview), `commitPreview()` (clears the flag), `cancelPreview()` (closes the preview tab, re-activates origin), `mru: string[]` updated on `activateTab`/`openFile` (max 50), `jumpTo(pos, col?)`, `gotoLine(line, col)`. Session snapshot: skip preview tabs; add `recentFiles` to `WindowSnapshot` (optional) and restore.

- [ ] **Step 1: Write failing tests**

`tests/unit/renderer/gotoParse.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseGotoQuery } from '@renderer/goto/parse'

describe('parseGotoQuery', () => {
  it.each([
    ['', { mode: 'files', file: '', symbol: null, line: null, col: null, word: null }],
    ['wksp', { mode: 'files', file: 'wksp', symbol: null, line: null, col: null, word: null }],
    ['@render', { mode: 'symbols', file: '', symbol: 'render', line: null, col: null, word: null }],
    [':12', { mode: 'lines', file: '', symbol: null, line: 12, col: null, word: null }],
    [':12:5', { mode: 'lines', file: '', symbol: null, line: 12, col: 5, word: null }],
    ['#todo', { mode: 'words', file: '', symbol: null, line: null, col: null, word: 'todo' }],
    ['wksp@render', { mode: 'files', file: 'wksp', symbol: 'render', line: null, col: null, word: null }],
    ['wksp:12', { mode: 'files', file: 'wksp', symbol: null, line: 12, col: null, word: null }],
    [':abc', { mode: 'lines', file: '', symbol: null, line: null, col: null, word: null }],
  ])('%s', (text, expected) => {
    expect(parseGotoQuery(text)).toEqual(expected)
  })
})
```

`tests/unit/renderer/symbols.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { languageById } from '@renderer/editor/lang'
import { symbolsOf, wordsOf } from '@renderer/goto/symbols'

const stateFor = (doc: string, languageId: string) => EditorState.create({ doc, extensions: languageById(languageId).load() })

describe('symbolsOf', () => {
  it('finds TypeScript functions, classes, methods and top-level consts', () => {
    const doc = `export const alpha = 1\nfunction beta() {}\nclass Gamma {\n  delta() {}\n}\nconst epsilon = () => 2\n`
    const names = symbolsOf(stateFor(doc, 'typescript'), 'typescript').map((s) => s.name)
    expect(names).toEqual(['alpha', 'beta', 'Gamma', 'delta', 'epsilon'])
  })

  it('finds markdown headings', () => {
    const doc = '# Title\n\ntext\n\n## Second\n### Third\n'
    expect(symbolsOf(stateFor(doc, 'markdown'), 'markdown').map((s) => s.name)).toEqual(['Title', 'Second', 'Third'])
  })

  it('finds python defs and classes', () => {
    const doc = 'def foo():\n    pass\n\nclass Bar:\n    def baz(self):\n        pass\n'
    expect(symbolsOf(stateFor(doc, 'python'), 'python').map((s) => s.name)).toEqual(['foo', 'Bar', 'baz'])
  })
})

describe('wordsOf', () => {
  it('lists unique words of 3+ characters in first-occurrence order', () => {
    const words = wordsOf(EditorState.create({ doc: 'the cat sat on the mat 한글 단어 cat\n' }))
    expect(words.map((w) => w.word)).toEqual(['the', 'cat', 'sat', 'mat', '한글', '단어'])
    expect(words[1]?.from).toBe(4)
  })
})
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement**

`src/renderer/src/goto/parse.ts`:
```ts
export type GotoMode = 'files' | 'symbols' | 'lines' | 'words'
export type GotoQuery = { mode: GotoMode; file: string; symbol: string | null; line: number | null; col: number | null; word: string | null }

const empty: GotoQuery = { mode: 'files', file: '', symbol: null, line: null, col: null, word: null }

const parseLine = (text: string): { line: number | null; col: number | null } => {
  const m = /^(\d+)?(?::(\d+))?$/.exec(text)
  if (!m || (!m[1] && !m[2])) return { line: null, col: null }
  return { line: m[1] ? Number(m[1]) : null, col: m[2] ? Number(m[2]) : null }
}

export const parseGotoQuery = (text: string): GotoQuery => {
  if (text.startsWith('@')) return { ...empty, mode: 'symbols', symbol: text.slice(1) }
  if (text.startsWith('#')) return { ...empty, mode: 'words', word: text.slice(1) }
  if (text.startsWith(':')) return { ...empty, mode: 'lines', ...parseLine(text.slice(1)) }

  const at = text.indexOf('@')
  if (at >= 0) return { ...empty, file: text.slice(0, at), symbol: text.slice(at + 1) }
  const colon = text.indexOf(':')
  if (colon >= 0) return { ...empty, file: text.slice(0, colon), ...parseLine(text.slice(colon + 1)) }
  return { ...empty, file: text }
}
```

`src/renderer/src/goto/symbols.ts`:
```ts
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

export type Symbol = { readonly name: string; readonly from: number; readonly kind: string }

type Rule = { readonly container: RegExp; readonly nameNode: RegExp }

const rules: Record<string, readonly Rule[]> = {
  typescript: [{ container: /^(FunctionDeclaration|ClassDeclaration|MethodDeclaration|VariableDeclaration|TypeAliasDeclaration|InterfaceDeclaration|EnumDeclaration)$/, nameNode: /^(VariableDefinition|PropertyDefinition|TypeDefinition)$/ }],
  python: [{ container: /^(FunctionDefinition|ClassDefinition)$/, nameNode: /^VariableName$/ }],
  rust: [{ container: /^(FunctionItem|StructItem|EnumItem|TraitItem|ImplItem|TypeItem)$/, nameNode: /^(BoundIdentifier|TypeIdentifier)$/ }],
  go: [{ container: /^(FunctionDecl|MethodDecl|TypeSpec)$/, nameNode: /^(DefName|TypeName)$/ }],
  markdown: [{ container: /^(ATXHeading[1-6]|SetextHeading[12])$/, nameNode: /^$/ }],
}

const aliases: Record<string, string> = { tsx: 'typescript', javascript: 'typescript', jsx: 'typescript' }

const firstChild = (node: SyntaxNode, pattern: RegExp): SyntaxNode | null => {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (pattern.test(child.name)) return child
    if (child.name === 'VariableDeclaration' || child.name === 'PropertyName') continue
  }
  return null
}

const headingText = (state: EditorState, node: SyntaxNode): string =>
  state.sliceDoc(node.from, node.to).replace(/^#+\s*/, '').replace(/\n[-=]+\s*$/, '').trim()

export const symbolsOf = (state: EditorState, languageId: string): Symbol[] => {
  const tree = ensureSyntaxTree(state, state.doc.length, 500)
  const active = rules[aliases[languageId] ?? languageId]
  if (!tree || !active) return []

  const out: Symbol[] = []
  tree.iterate({
    enter: (ref) => {
      const rule = active.find((r) => r.container.test(ref.name))
      if (!rule) return
      const node = ref.node
      if (languageId === 'markdown') {
        out.push({ name: headingText(state, node), from: node.from, kind: ref.name })
        return false
      }
      const nameNode = firstChild(node, rule.nameNode) ?? (ref.name === 'VariableDeclaration' ? deepFind(node, rule.nameNode) : null)
      if (nameNode) out.push({ name: state.sliceDoc(nameNode.from, nameNode.to), from: nameNode.from, kind: ref.name })
      return undefined
    },
  })
  return out
}

const deepFind = (node: SyntaxNode, pattern: RegExp): SyntaxNode | null => {
  const cursor = node.cursor()
  if (!cursor.firstChild()) return null
  do {
    if (pattern.test(cursor.name)) return cursor.node
    const inner = deepFind(cursor.node, pattern)
    if (inner) return inner
  } while (cursor.nextSibling())
  return null
}

export const wordsOf = (state: EditorState, limit = 5000): { word: string; from: number }[] => {
  const seen: Record<string, true> = {}
  const out: { word: string; from: number }[] = []
  const text = state.doc.toString()
  for (const m of text.matchAll(/[\p{L}_][\p{L}\p{N}_]{2,}/gu)) {
    if (seen[m[0]]) continue
    seen[m[0]] = true
    out.push({ word: m[0], from: m.index ?? 0 })
    if (out.length >= limit) break
  }
  return out
}
```
Adjust node names against the real Lezer grammars while running the unit test (`console.log(tree.toString())` if a name differs — e.g. TS `VariableDeclaration` contains `VariableDefinition` directly; class members are `MethodDeclaration` with `PropertyDefinition`; Python `FunctionDefinition` has `VariableName`; Go `FunctionDecl` has `DefName`, `TypeSpec` has `TypeName`).

Workspace preview/MRU/jump: as in Interfaces; `TabStrip` adds class `preview` (italic) when `tab.preview`. Session: skip preview tabs in `paneSnapshot`; `recentFiles` in snapshot (optional array) restored into `mru`.

- [ ] **Step 4: Run** — unit PASS; typecheck/build PASS.

- [ ] **Step 5: Commit** — `feat(goto): query parsing, symbol and word extraction, preview tabs, MRU`

---

### Task 3: Palette goto mode

**Files:**
- Rename/modify: `src/renderer/src/ui/palette/CommandPalette.tsx` → `src/renderer/src/ui/palette/Palette.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/app/registerCommands.ts`, `src/renderer/src/keymap/defaults.ts`, `src/renderer/src/testHooks.ts`, `src/renderer/src/style.css`, `src/main/menu.ts`
- Test: `tests/e2e/goto.spec.ts`

**Interfaces:**
- `Palette` props: `open: Accessor<PaletteMode | null>` where `PaletteMode = 'commands' | 'goto'`, `initialText: Accessor<string>`, `onClose`, `registry`, `bindings`, `platform`, `ws`.
- Goto items: `{ kind: 'file'; path; rel; positions } | { kind: 'symbol'; name; from } | { kind: 'line'; line; col } | { kind: 'word'; word; from } | { kind: 'recent'; path; rel }`. Empty query → recent (MRU ∩ still-existing, top 20) else the first 20 index items.
- Behaviour: arrowing over file/recent items calls `ws.previewFile(path)` (debounced 80 ms); Enter → `commitPreview()` then apply `symbol`/`line` suffix if present; Escape → `cancelPreview()` and close. Symbol/word/line items act on the active buffer immediately on Enter (`jumpTo`). While arrowing symbols, the editor selection follows (`jumpTo` without commit); Escape restores the original selection.
- Commands: `palette.goto` (`mod+p`), `palette.gotoSymbol` (`mod+r`, initial `@`), `palette.gotoLine` (`ctrl+g`, initial `:`), `palette.gotoWord` (`mod+;`, initial `#`). Menu: Goto → Goto Anything… / Goto Symbol… / Goto Line….
- Index bootstrap: `App.tsx` calls `index.build` whenever `projectRoot` changes (skip when null); palette shows `no folder open` hint when `projectRoot` is null and mode is files.
- Test hooks: `paletteMode(): string | null`, `paletteItems(): string[]` (visible labels).

- [ ] **Step 1: Write the failing E2E**

`tests/e2e/goto.spec.ts`:
```ts
import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const tabs = (page: Page) => page.evaluate(() => window.__moruTest!.tabs())
const items = (page: Page) => page.evaluate(() => window.__moruTest!.paletteItems())

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'moru-goto-'))
  mkdirSync(join(root, 'src', 'app'), { recursive: true })
  writeFileSync(join(root, 'src', 'app', 'workspace.ts'), 'export const alpha = 1\nfunction beta() {}\nclass Gamma {}\n')
  writeFileSync(join(root, 'src', 'notes.md'), '# Notes\n\n## Later\n')
  writeFileSync(join(root, 'README.md'), Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') + '\n')
  return root
}

test('cmd+p fuzzy-finds files, previews while arrowing, commits on enter, escape restores', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root, MORU_TEST_OPEN: join(root, 'README.md') })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+p`)
  await expect(page.getByTestId('palette')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__moruTest!.paletteMode())).toBe('goto')

  await page.keyboard.type('wksp')
  await expect.poll(() => items(page)).toContain('src/app/workspace.ts')
  await expect.poll(async () => (await tabs(page))[0]?.tabs.map((t) => t.title)).toEqual(['README.md', 'workspace.ts'])

  await page.keyboard.press('Escape')
  await expect.poll(async () => (await tabs(page))[0]?.tabs.map((t) => t.title)).toEqual(['README.md'])
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'README.md'))

  await page.keyboard.press(`${mod}+p`)
  await page.keyboard.type('notes')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'src', 'notes.md'))
  await expect(page.getByTestId('palette')).toBeHidden()
  await app.close()
})

test('file@symbol and file:line jump after opening', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root })
  await page.keyboard.press(`${mod}+p`)
  await page.keyboard.type('wksp@gam')
  await expect.poll(() => items(page)).toContain('Gamma')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'src', 'app', 'workspace.ts'))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.selections()[0]?.from)).toBe(48)

  await page.keyboard.press(`${mod}+p`)
  await page.keyboard.type('readme:30')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'README.md'))
  await expect(page.getByTestId('pos')).toHaveText('Ln 30, Col 1')
  await app.close()
})

test('@symbol, :line and #word on the active buffer', async () => {
  const root = project()
  const file = join(root, 'src', 'app', 'workspace.ts')
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root, MORU_TEST_OPEN: file })
  await page.evaluate(() => window.__moruTest!.focus())

  await page.keyboard.press(`${mod}+r`)
  await expect.poll(() => items(page)).toEqual(['alpha', 'beta', 'Gamma'])
  await page.keyboard.type('bet')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.selections()[0]?.from)).toBe(32)

  await page.keyboard.press('Control+g')
  await page.keyboard.type('3')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('pos')).toHaveText('Ln 3, Col 1')

  await page.keyboard.press(`${mod}+p`)
  await page.keyboard.type('#alp')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.selections()[0]?.from)).toBe(13)
  await app.close()
})

test('empty query lists recent files first', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root })
  await page.evaluate((p) => window.__moruTest!.openPath(p), join(root, 'src', 'notes.md'))
  await page.evaluate((p) => window.__moruTest!.openPath(p), join(root, 'README.md'))
  await page.keyboard.press(`${mod}+p`)
  await expect.poll(() => items(page).then((xs) => xs.slice(0, 2))).toEqual(['README.md', 'src/notes.md'])
  await page.keyboard.press('Escape')
  await app.close()
})
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement** — per Interfaces; keep `CommandPalette` behaviour for the commands mode; add goto mode rendering `<span class="palette-title">` with `positions` highlighted (`<mark>`), `<span class="palette-keys">` shows directory for files; for `recent` items prefix `⟲`.

- [ ] **Step 4: Run** — `pnpm typecheck && pnpm test && pnpm build && pnpm exec playwright test` → all PASS.

- [ ] **Step 5: Commit** — `feat(goto): Goto Anything palette with files, symbols, lines, words, preview tabs and MRU`

---

### Task 4: Report

- [ ] `pnpm check`; write `docs/superpowers/reports/m3c-goto-anything.md` incl. the measured 50k query time; tick; commit `docs(m3c): add Goto Anything report`. Mark **M3 complete** in the report.

## Self-Review Notes

- §5.3 항목: 문법 6종 (T2 parse, T3), 인덱스 rg+NFC+증분 갱신+20만 cap (T1), fzf < 30 ms (T1 perf), MRU 랭킹 (T3), 미리보기 탭 (T2/T3), `@` Lezer 순회 (T2), `#` 단어 (T2), 커맨드 팔레트 유지 (T3).
- Hooks: `paletteMode`, `paletteItems`.
