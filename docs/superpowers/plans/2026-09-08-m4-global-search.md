# M4 Global Search & Replace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sublime's "Find in Files": a `search` tab that streams `rg --json` results into a file → match tree, corrects results for dirty open buffers, previews `old → new` replacements, applies "Replace All" (closed files atomically in main with hash verification; open buffers as CM6 transactions without saving), and offers a global "Undo Replace in Files".

**Architecture:** Main `search/run.ts` spawns ripgrep with the query flags and pushes 50 ms batches (`search.batch`) then `search.done`; a new query for the same id kills the previous process. Main `search/replace.ts` re-runs the regex on the listed lines of each closed file (never trusting stored offsets), verifies the search-time hash, writes atomically and keeps pre-images for the last five operations (`search.undoLast`). The renderer owns a `search` tab kind whose state (spec, tree, exclusions, replace text) lives in the workspace store; `SearchHost` renders it. Regex compilation, replacement expansion and case preservation live in `src/shared/replaceText.ts` so preview (renderer) and apply (main) agree byte-for-byte.

**Tech Stack:** `@vscode/ripgrep` (`rg --json`), Node `child_process.spawn`, zod IPC contracts, Solid store, CodeMirror 6 transactions, Vitest, Playwright `_electron`.

**Spec:** `docs/superpowers/specs/2026-09-08-text-editor-design.md` §3.5 (Tab = search), §4.7 (search.* channels), §5.2 "프로젝트 전역", §6.2 (rg 없음/실패), §8 M4 row.

## Global Constraints

- IPC responses are always `IpcResult<T, E>`; every channel has zod request/response contracts in `src/shared/ipc.ts`; push channels in `pushContracts`; channel names added to `src/shared/channels.ts` allowlists.
- Renderer never touches disk. Text state of open buffers is owned by the renderer; main only edits closed files.
- Commit directly to `main`, no signing: `git -c commit.gpgsign=false commit`.
- E2E runs hidden (`MORU_HIDDEN=1`, set by `tests/e2e/launch.ts`).
- Match cap 10,000 per query (`truncated: true` beyond). Default `--max-filesize 10M`. `.gitignore` respected; `.git/` always excluded.
- Encoding: default auto (rg reads UTF-8 / UTF-16 BOM). `search.encoding` setting (e.g. `cp949`) is passed as `-E`.
- Performance: 10k-file fixture search completes (done pushed) in < 3 s on CI, first batch < 300 ms.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/replaceText.ts` (create) | `toRegExp(spec)`, `expandReplacement`, `preserveCaseOf`, `replaceInLine` — the single source of truth for match/replace semantics |
| `src/shared/search.ts` (create) | zod: `SearchSpec`, `SearchMatch`, `SearchBatch`, `SearchDone`, `ReplacePlan`, `ReplaceReport` |
| `src/shared/ipc.ts` (modify) | `search.run`, `search.cancel`, `search.replace`, `search.undoLast` contracts; `search.batch`, `search.done` push contracts |
| `src/shared/channels.ts` (modify) | channel names |
| `src/shared/config.ts` (modify) | `search: { encoding, maxFileSizeMb, exclude }` settings |
| `src/shared/session.ts` (modify) | `SearchTabSnapshot { kind: 'search', spec }` |
| `src/main/search/rgJson.ts` (create) | parse `rg --json` lines → `SearchMatch[]`, byte → UTF-16 offsets |
| `src/main/search/args.ts` (create) | `SearchSpec` → rg argv |
| `src/main/search/run.ts` (create) | `createSearchService`: spawn/kill/batch/push |
| `src/main/search/replace.ts` (create) | `replaceInFiles(plan)`, pre-image ring, `undoLast()` |
| `src/main/ipc/handlers.ts`, `src/main/index.ts` (modify) | wire service, handlers |
| `src/renderer/src/search/state.ts` (create) | `SearchState`, tree building, exclusion toggles, preview computation, dirty-buffer correction |
| `src/renderer/src/search/local.ts` (create) | run a spec against an `EditorState` → `SearchMatch[]` |
| `src/renderer/src/app/workspace.ts` (modify) | `search` tab kind, `openSearch`, `runSearch`, `replaceAll`, `undoReplace`, session snapshot/restore |
| `src/renderer/src/ui/search/SearchHost.tsx` (create) | tab UI: inputs, toggles, tree, replace preview, status |
| `src/renderer/src/ui/layout/PaneView.tsx`, `ui/tabs/TabStrip.tsx` (modify) | render search tab, title |
| `src/renderer/src/app/registerCommands.ts`, `keymap/defaults.ts`, `src/main/menu.ts`, `testHooks.ts`, `style.css` (modify) | commands `search.project` (`mod+shift+f`), `search.undoReplace`; menu Find → Find in Files… / Undo Replace in Files |
| `tests/unit/shared/replaceText.test.ts`, `tests/unit/main/rgJson.test.ts`, `tests/unit/main/searchArgs.test.ts`, `tests/unit/main/searchRun.test.ts`, `tests/unit/main/searchReplace.test.ts`, `tests/unit/renderer/searchState.test.ts` | unit |
| `tests/e2e/search.spec.ts` | E2E: stream, dirty correction, click-to-open, replace all (closed + open), undo |

---

### Task 1: Shared match/replace semantics and contracts

**Files:**
- Create: `src/shared/replaceText.ts`, `src/shared/search.ts`
- Modify: `src/shared/ipc.ts`, `src/shared/channels.ts`, `src/shared/config.ts`, `src/renderer/src/find/state.ts` (re-export `preserveCaseOf`)
- Test: `tests/unit/shared/replaceText.test.ts`, `tests/unit/shared/ipc.test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  // src/shared/search.ts
  export const SearchSpec = z.object({
    pattern: z.string(), regexp: z.boolean(), caseSensitive: z.boolean(), wholeWord: z.boolean(),
    include: z.string().default(''), exclude: z.string().default(''),
  })
  export const SearchMatch = z.object({ path: z.string(), line: z.number().int().positive(), text: z.string(), from: z.number().int(), to: z.number().int() })
  // from/to are UTF-16 offsets inside `text` (the line without its terminator)
  export const SearchBatch = z.object({ id: z.string(), matches: z.array(SearchMatch) })
  export const SearchDone = z.object({ id: z.string(), files: z.number().int(), matches: z.number().int(), truncated: z.boolean(), error: z.string().nullable() })
  export const ReplacePlan = z.object({
    spec: SearchSpec, replacement: z.string(), preserveCase: z.boolean(),
    files: z.array(z.object({ path: z.string(), hash: z.string(), lines: z.array(z.object({ line: z.number().int().positive(), skip: z.array(z.number().int()).default([]) })) })),
  })
  export const ReplaceReport = z.object({
    changed: z.array(z.object({ path: z.string(), matches: z.number().int() })),
    skipped: z.array(z.object({ path: z.string(), reason: z.enum(['hashMismatch', 'readError', 'writeError', 'encodingLossy', 'notFound']) })),
  })
  ```
  ```ts
  // src/shared/replaceText.ts
  export type MatchSpec = { pattern: string; regexp: boolean; caseSensitive: boolean; wholeWord: boolean }
  export const toRegExp = (spec: MatchSpec): RegExp | null          // null when invalid; flags 'gu' + 'i' unless caseSensitive; literal is escaped; wholeWord wraps (?<![\p{L}\p{N}_])…(?![\p{L}\p{N}_])
  export const preserveCaseOf = (sample: string, replacement: string): string
  export const expandReplacement = (m: RegExpExecArray, template: string, regexp: boolean): string  // $1 $<name> $$ \n \t ; literal mode returns template verbatim
  export type LineEdit = { from: number; to: number; insert: string }
  export const matchesInLine = (line: string, re: RegExp): { from: number; to: number; exec: RegExpExecArray }[]
  export const replaceInLine = (line: string, spec: MatchSpec, replacement: string, preserveCase: boolean, skip: readonly number[] = []): { text: string; edits: LineEdit[] } | null
  ```
- Settings: `search: z.object({ encoding: z.enum(['auto', ...encodingNames]).default('auto'), maxFileSizeMb: z.number().int().min(1).max(1024).default(10), exclude: z.array(z.string()).default([]) }).prefault({})`.

- [ ] **Step 1: Write the failing tests** — `tests/unit/shared/replaceText.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { expandReplacement, matchesInLine, preserveCaseOf, replaceInLine, toRegExp } from '../../../src/shared/replaceText'

const lit = { pattern: 'foo', regexp: false, caseSensitive: false, wholeWord: false }

describe('toRegExp', () => {
  it('escapes literals and applies case/word flags', () => {
    expect(toRegExp(lit)!.source).toBe('foo')
    expect(toRegExp({ ...lit, pattern: 'a.b(' })!.test('a.b(')).toBe(true)
    expect(toRegExp({ ...lit, pattern: 'a.b(' })!.test('axb(')).toBe(false)
    expect(toRegExp({ ...lit, caseSensitive: true })!.flags).toBe('gu')
    expect(toRegExp(lit)!.flags).toBe('giu')
    const word = toRegExp({ ...lit, wholeWord: true })!
    expect('foo foobar 한글foo'.match(word)?.length).toBe(1)
  })
  it('returns null for an invalid regex', () => {
    expect(toRegExp({ ...lit, regexp: true, pattern: '(' })).toBeNull()
  })
})

describe('expandReplacement', () => {
  it('expands groups, named groups, $$ and escapes in regex mode only', () => {
    const re = /(?<first>\w+)-(\w+)/gu
    const m = re.exec('ab-cd')!
    expect(expandReplacement(m, '$2_$<first>$$\\n', true)).toBe('cd_ab$\n')
    expect(expandReplacement(m, '$2_$1', false)).toBe('$2_$1')
  })
})

describe('preserveCaseOf', () => {
  it('mirrors ALL CAPS, Capitalized and lower', () => {
    expect(preserveCaseOf('FOO', 'bar')).toBe('BAR')
    expect(preserveCaseOf('Foo', 'bar')).toBe('Bar')
    expect(preserveCaseOf('foo', 'Bar')).toBe('bar')
    expect(preserveCaseOf('fOo', 'bar')).toBe('bar')
  })
})

describe('replaceInLine', () => {
  it('replaces every match on the line and reports edits in UTF-16 offsets', () => {
    const r = replaceInLine('한글 foo Foo', lit, 'bar', true)!
    expect(r.text).toBe('한글 bar Bar')
    expect(r.edits).toEqual([{ from: 3, to: 6, insert: 'bar' }, { from: 7, to: 10, insert: 'Bar' }])
  })
  it('skips excluded match indexes and returns null when nothing matches', () => {
    expect(replaceInLine('foo foo', lit, 'x', false, [0])).toEqual({ text: 'foo x', edits: [{ from: 4, to: 7, insert: 'x' }] })
    expect(replaceInLine('nope', lit, 'x', false)).toBeNull()
  })
  it('matchesInLine handles zero-width regex without looping forever', () => {
    expect(matchesInLine('abc', /x*/gu).length).toBe(4)
  })
})
```

- [ ] **Step 2: Run** `pnpm vitest run tests/unit/shared/replaceText.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement** `src/shared/replaceText.ts`

```ts
export type MatchSpec = { readonly pattern: string; readonly regexp: boolean; readonly caseSensitive: boolean; readonly wholeWord: boolean }
export type LineEdit = { readonly from: number; readonly to: number; readonly insert: string }

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

export const toRegExp = (spec: MatchSpec): RegExp | null => {
  if (spec.pattern === '') return null
  const body = spec.regexp ? spec.pattern : escapeRegExp(spec.pattern)
  const source = spec.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])` : body
  try {
    return new RegExp(source, spec.caseSensitive ? 'gu' : 'giu')
  } catch {
    return null
  }
}

export const preserveCaseOf = (sample: string, replacement: string): string => {
  if (sample === '' || replacement === '') return replacement
  if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) return replacement.toUpperCase()
  if (sample === sample.toLowerCase()) return replacement.toLowerCase()
  const [first, ...rest] = sample
  if (first === first?.toUpperCase() && rest.join('') === rest.join('').toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase()
  }
  return replacement
}

export const expandReplacement = (m: RegExpExecArray, template: string, regexp: boolean): string => {
  if (!regexp) return template
  return template.replace(/\$\$|\$(\d+)|\$<([^>]+)>|\\n|\\t/g, (token, index: string | undefined, name: string | undefined) => {
    if (token === '$$') return '$'
    if (token === '\\n') return '\n'
    if (token === '\\t') return '\t'
    if (index !== undefined) return m[Number(index)] ?? ''
    return m.groups?.[name ?? ''] ?? ''
  })
}

export const matchesInLine = (line: string, re: RegExp): { from: number; to: number; exec: RegExpExecArray }[] => {
  const out: { from: number; to: number; exec: RegExpExecArray }[] = []
  re.lastIndex = 0
  for (let m = re.exec(line); m !== null; m = re.exec(line)) {
    out.push({ from: m.index, to: m.index + m[0].length, exec: m })
    if (m[0] === '') re.lastIndex = m.index + 1
    if (re.lastIndex > line.length) break
  }
  return out
}

export const replaceInLine = (
  line: string,
  spec: MatchSpec,
  replacement: string,
  preserveCase: boolean,
  skip: readonly number[] = [],
): { text: string; edits: LineEdit[] } | null => {
  const re = toRegExp(spec)
  if (!re) return null

  const edits = matchesInLine(line, re)
    .filter((_, i) => !skip.includes(i))
    .map(({ from, to, exec }) => {
      const expanded = expandReplacement(exec, replacement, spec.regexp)
      return { from, to, insert: preserveCase ? preserveCaseOf(exec[0], expanded) : expanded }
    })
  if (edits.length === 0) return null

  const text = edits.reduceRight((acc, e) => acc.slice(0, e.from) + e.insert + acc.slice(e.to), line)
  return { text, edits }
}
```

Replace the body of `preserveCaseOf` in `src/renderer/src/find/state.ts` with `export { preserveCaseOf } from '@shared/replaceText'` (delete the local definition; keep the other exports).

- [ ] **Step 4: Contracts** — create `src/shared/search.ts` with the schemas from Interfaces (add inferred types with the same names). In `src/shared/ipc.ts` add:

```ts
'search.run': { request: z.object({ id: z.string(), spec: SearchSpec, roots: z.array(z.string()).min(1) }), response: ipcResult(z.literal(true), UnexpectedError) },
'search.cancel': { request: z.object({ id: z.string() }), response: ipcResult(z.literal(true), UnexpectedError) },
'search.replace': { request: ReplacePlan, response: ipcResult(ReplaceReport, UnexpectedError) },
'search.undoLast': { request: z.undefined(), response: ipcResult(ReplaceReport.nullable(), UnexpectedError) },
```
and push contracts `'search.batch': SearchBatch, 'search.done': SearchDone`. Add the six names to `src/shared/channels.ts` (invoke list + `pushChannels`). Add the `search` settings block to `Settings` in `src/shared/config.ts`. Extend `tests/unit/shared/ipc.test.ts` with one case: `contracts['search.run'].request.parse({ id: 'a', spec: { pattern: 'x', regexp: false, caseSensitive: false, wholeWord: false }, roots: ['/r'] })` fills `include: ''`.

- [ ] **Step 5: Run** `pnpm vitest run tests/unit/shared && pnpm typecheck` — PASS, 0 errors.

- [ ] **Step 6: Commit** — `feat(search): shared match/replace semantics, search contracts and settings`

---

### Task 2: ripgrep JSON parsing and argv

**Files:**
- Create: `src/main/search/rgJson.ts`, `src/main/search/args.ts`
- Test: `tests/unit/main/rgJson.test.ts`, `tests/unit/main/searchArgs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // rgJson.ts
  export type RgEvent = { kind: 'match'; matches: SearchMatch[] } | { kind: 'end'; path: string } | { kind: 'summary'; matched: number } | { kind: 'other' }
  export const parseRgLine = (line: string): RgEvent          // never throws; malformed → { kind: 'other' }
  export const byteToCharOffset = (text: string, byteOffset: number): number
  // args.ts
  export const rgArgs = (spec: SearchSpec, roots: readonly string[], opts: { encoding: 'auto' | string; maxFileSizeMb: number; exclude: readonly string[] }): string[]
  ```

- [ ] **Step 1: Failing tests**

`tests/unit/main/rgJson.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { byteToCharOffset, parseRgLine } from '../../../src/main/search/rgJson'

const matchLine = JSON.stringify({
  type: 'match',
  data: {
    path: { text: '/r/a.ts' },
    lines: { text: '한글 foo 한 foo\n' },
    line_number: 3,
    absolute_offset: 100,
    submatches: [
      { match: { text: 'foo' }, start: 7, end: 10 },
      { match: { text: 'foo' }, start: 15, end: 18 },
    ],
  },
})

describe('parseRgLine', () => {
  it('converts byte submatch offsets to UTF-16 offsets and strips the line terminator', () => {
    const ev = parseRgLine(matchLine)
    expect(ev).toEqual({
      kind: 'match',
      matches: [
        { path: '/r/a.ts', line: 3, text: '한글 foo 한 foo', from: 3, to: 6 },
        { path: '/r/a.ts', line: 3, text: '한글 foo 한 foo', from: 9, to: 12 },
      ],
    })
  })
  it('maps end/summary and tolerates garbage', () => {
    expect(parseRgLine(JSON.stringify({ type: 'end', data: { path: { text: '/r/a.ts' } } }))).toEqual({ kind: 'end', path: '/r/a.ts' })
    expect(parseRgLine(JSON.stringify({ type: 'summary', data: { stats: { matches: 7 } } }))).toEqual({ kind: 'summary', matched: 7 })
    expect(parseRgLine('not json')).toEqual({ kind: 'other' })
    expect(parseRgLine(JSON.stringify({ type: 'match', data: { path: { bytes: 'AA==' }, lines: { text: 'x' }, line_number: 1, submatches: [] } }))).toEqual({ kind: 'other' })
  })
  it('byteToCharOffset clamps', () => {
    expect(byteToCharOffset('한a', 3)).toBe(1)
    expect(byteToCharOffset('한a', 99)).toBe(2)
  })
})
```

`tests/unit/main/searchArgs.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { rgArgs } from '../../../src/main/search/args'

const spec = { pattern: 'foo', regexp: false, caseSensitive: false, wholeWord: false, include: '', exclude: '' }
const opts = { encoding: 'auto', maxFileSizeMb: 10, exclude: ['**/dist/**'] }

describe('rgArgs', () => {
  it('builds literal, smart flags and globs', () => {
    expect(rgArgs(spec, ['/r'], opts)).toEqual([
      '--json', '--hidden', '--glob', '!.git/**', '--glob', '!**/dist/**', '--max-filesize', '10M', '-i', '-F', '-e', 'foo', '--', '/r',
    ])
  })
  it('passes regex, case, word, include/exclude globs and encoding', () => {
    expect(rgArgs({ ...spec, regexp: true, caseSensitive: true, wholeWord: true, include: '*.ts, src/**', exclude: '*.md' }, ['/a', '/b'], { ...opts, encoding: 'cp949', exclude: [] })).toEqual([
      '--json', '--hidden', '--glob', '!.git/**', '--max-filesize', '10M', '-E', 'cp949', '-w', '--glob', '*.ts', '--glob', 'src/**', '--glob', '!*.md', '-e', 'foo', '--', '/a', '/b',
    ])
  })
})
```

- [ ] **Step 2: Run** both — FAIL.

- [ ] **Step 3: Implement**

`src/main/search/rgJson.ts`:
```ts
import type { SearchMatch } from '@shared/search'

export type RgEvent =
  | { kind: 'match'; matches: SearchMatch[] }
  | { kind: 'end'; path: string }
  | { kind: 'summary'; matched: number }
  | { kind: 'other' }

export const byteToCharOffset = (text: string, byteOffset: number): number => {
  const bytes = Buffer.from(text, 'utf8')
  return bytes.subarray(0, Math.min(byteOffset, bytes.length)).toString('utf8').length
}

type RgMatch = {
  path: { text?: string }
  lines: { text?: string }
  line_number: number
  submatches: { start: number; end: number }[]
}

const stripTerminator = (line: string): string => line.replace(/\r?\n$/, '')

export const parseRgLine = (line: string): RgEvent => {
  let parsed: { type?: string; data?: unknown }
  try {
    parsed = JSON.parse(line) as { type?: string; data?: unknown }
  } catch {
    return { kind: 'other' }
  }
  const data = parsed.data as Record<string, unknown> | undefined
  if (!data) return { kind: 'other' }

  if (parsed.type === 'match') {
    const m = data as unknown as RgMatch
    const path = m.path?.text
    const raw = m.lines?.text
    if (typeof path !== 'string' || typeof raw !== 'string') return { kind: 'other' }
    const text = stripTerminator(raw)
    return {
      kind: 'match',
      matches: m.submatches.map((s) => ({ path, line: m.line_number, text, from: byteToCharOffset(raw, s.start), to: byteToCharOffset(raw, s.end) })),
    }
  }
  if (parsed.type === 'end') {
    const path = (data['path'] as { text?: string } | undefined)?.text
    return typeof path === 'string' ? { kind: 'end', path } : { kind: 'other' }
  }
  if (parsed.type === 'summary') {
    const matched = (data['stats'] as { matches?: number } | undefined)?.matches ?? 0
    return { kind: 'summary', matched }
  }
  return { kind: 'other' }
}
```

`src/main/search/args.ts`:
```ts
import type { SearchSpec } from '@shared/search'

const splitGlobs = (text: string): string[] => text.split(',').map((g) => g.trim()).filter((g) => g !== '')

export const rgArgs = (
  spec: SearchSpec,
  roots: readonly string[],
  opts: { encoding: 'auto' | string; maxFileSizeMb: number; exclude: readonly string[] },
): string[] => [
  '--json',
  '--hidden',
  '--glob', '!.git/**',
  ...opts.exclude.flatMap((g) => ['--glob', `!${g}`]),
  '--max-filesize', `${opts.maxFileSizeMb}M`,
  ...(opts.encoding === 'auto' ? [] : ['-E', opts.encoding]),
  ...(spec.caseSensitive ? [] : ['-i']),
  ...(spec.wholeWord ? ['-w'] : []),
  ...(spec.regexp ? [] : ['-F']),
  ...splitGlobs(spec.include).flatMap((g) => ['--glob', g]),
  ...splitGlobs(spec.exclude).flatMap((g) => ['--glob', `!${g}`]),
  '-e', spec.pattern,
  '--',
  ...roots,
]
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `feat(search): rg --json parser and argv builder`

---

### Task 3: Search service (spawn, batch, cancel) with 10k-file fixture

**Files:**
- Create: `src/main/search/run.ts`
- Modify: `src/main/ipc/handlers.ts`, `src/main/index.ts`
- Test: `tests/unit/main/searchRun.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SearchService = {
    run: (id: string, spec: SearchSpec, roots: readonly string[]) => void   // kills a running query with the same id first
    cancel: (id: string) => void
    dispose: () => void
  }
  export const createSearchService = (deps: { rgPath: string; push: Push; settings: () => { encoding: string; maxFileSizeMb: number; exclude: readonly string[] }; batchMs?: number; cap?: number }): SearchService
  ```
- Behaviour: stdout is read line-by-line (`readline`); `match` events accumulate; every `batchMs` (50) a `search.batch` is pushed if non-empty; on process close push the remaining batch then `search.done { files, matches, truncated, error }`. `files` counts `end` events with ≥ 1 match. Exit code 2 → `error` = trimmed stderr (first 300 chars). When `matches ≥ cap` the process is killed and `truncated: true`. `cancel` kills without pushing `done`. Spawn failure (ENOENT) → `done` with `error: 'ripgrep not found'`.

- [ ] **Step 1: Failing test** — `tests/unit/main/searchRun.test.ts`

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rgPath } from '@vscode/ripgrep'
import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import type { SearchDone, SearchMatch } from '../../../src/shared/search'
import { createSearchService } from '../../../src/main/search/run'

const settings = () => ({ encoding: 'auto', maxFileSizeMb: 10, exclude: [] })
const spec = { pattern: 'needle', regexp: false, caseSensitive: false, wholeWord: false, include: '', exclude: '' }

const collect = (service: ReturnType<typeof createSearchService>, id: string, run: () => void) =>
  new Promise<{ matches: SearchMatch[]; done: SearchDone }>((resolve) => {
    const matches: SearchMatch[] = []
    pushes.push((channel, payload) => {
      if (channel === 'search.batch' && payload.id === id) matches.push(...(payload as { matches: SearchMatch[] }).matches)
      if (channel === 'search.done' && payload.id === id) resolve({ matches, done: payload as SearchDone })
    })
    run()
  })

let pushes: ((channel: string, payload: { id: string }) => void)[] = []
const push = (channel: string, payload: unknown) => pushes.forEach((p) => p(channel, payload as { id: string }))

let root: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'moru-search-'))
  mkdirSync(join(root, 'sub'))
  writeFileSync(join(root, 'a.txt'), 'x\nthe Needle here\nneedle again needle\n')
  writeFileSync(join(root, 'sub', 'b.md'), '# no\n')
  writeFileSync(join(root, 'sub', 'c.ts'), 'const needle = 1\n')
  writeFileSync(join(root, '.gitignore'), 'ignored.txt\n')
  writeFileSync(join(root, 'ignored.txt'), 'needle\n')
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('search service', () => {
  it('streams matches with UTF-16 offsets, counts files and respects .gitignore', async () => {
    const service = createSearchService({ rgPath, push: push as never, settings, batchMs: 10 })
    const { matches, done } = await collect(service, 'q1', () => service.run('q1', spec, [root]))
    expect(done).toEqual({ id: 'q1', files: 2, matches: 4, truncated: false, error: null })
    expect(matches.map((m) => [m.path.replace(root, ''), m.line, m.from, m.to]).sort()).toEqual([
      ['/a.txt', 2, 4, 10], ['/a.txt', 3, 0, 6], ['/a.txt', 3, 13, 19], ['/sub/c.ts', 1, 6, 12],
    ])
    service.dispose()
  })

  it('reports regex errors and honours the cap', async () => {
    const service = createSearchService({ rgPath, push: push as never, settings, batchMs: 10, cap: 2 })
    const bad = await collect(service, 'q2', () => service.run('q2', { ...spec, regexp: true, pattern: '(' }, [root]))
    expect(bad.done.error).toMatch(/regex|parse|unclosed/i)
    const capped = await collect(service, 'q3', () => service.run('q3', spec, [root]))
    expect(capped.done.truncated).toBe(true)
    expect(capped.matches.length).toBeLessThanOrEqual(3)
    service.dispose()
  })

  it('finishes a 10k-file fixture within budget', async () => {
    const big = mkdtempSync(join(tmpdir(), 'moru-search-big-'))
    for (let d = 0; d < 100; d++) {
      mkdirSync(join(big, `d${d}`))
      for (let f = 0; f < 100; f++) writeFileSync(join(big, `d${d}`, `f${f}.txt`), `line one\n${f % 10 === 0 ? 'needle' : 'hay'} ${d}-${f}\n`)
    }
    const service = createSearchService({ rgPath, push: push as never, settings, batchMs: 50 })
    const started = performance.now()
    const { done } = await collect(service, 'big', () => service.run('big', spec, [big]))
    const elapsed = performance.now() - started
    console.log(`10k-file search: ${elapsed.toFixed(0)} ms`)
    expect(done.matches).toBe(1000)
    expect(elapsed).toBeLessThan(process.env.CI ? 6000 : 3000)
    service.dispose()
    rmSync(big, { recursive: true, force: true })
  }, 30_000)
})
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `src/main/search/run.ts`

```ts
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { PushChannel, PushPayload } from '@shared/ipc'
import type { SearchMatch, SearchSpec } from '@shared/search'
import { rgArgs } from './args'
import { parseRgLine } from './rgJson'

type Push = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void
type SearchSettings = { readonly encoding: string; readonly maxFileSizeMb: number; readonly exclude: readonly string[] }

type Deps = { readonly rgPath: string; readonly push: Push; readonly settings: () => SearchSettings; readonly batchMs?: number; readonly cap?: number }

export type SearchService = {
  readonly run: (id: string, spec: SearchSpec, roots: readonly string[]) => void
  readonly cancel: (id: string) => void
  readonly dispose: () => void
}

type Running = { child: ChildProcessWithoutNullStreams; cancelled: boolean }

export const createSearchService = ({ rgPath, push, settings, batchMs = 50, cap = 10_000 }: Deps): SearchService => {
  const running: Record<string, Running> = {}

  const kill = (id: string): void => {
    const entry = running[id]
    if (!entry) return
    entry.cancelled = true
    entry.child.kill()
    delete running[id]
  }

  const run = (id: string, spec: SearchSpec, roots: readonly string[]): void => {
    kill(id)
    const child = spawn(rgPath, rgArgs(spec, roots, settings()), { stdio: ['ignore', 'pipe', 'pipe'] })
    const entry: Running = { child, cancelled: false }
    running[id] = entry

    let pending: SearchMatch[] = []
    let files = 0
    let total = 0
    let truncated = false
    let stderr = ''
    const flush = (): void => {
      if (pending.length === 0) return
      push('search.batch', { id, matches: pending })
      pending = []
    }
    const timer = setInterval(flush, batchMs)

    createInterface({ input: child.stdout }).on('line', (line) => {
      const event = parseRgLine(line)
      if (event.kind === 'match') {
        pending.push(...event.matches)
        total += event.matches.length
        if (total >= cap && !truncated) {
          truncated = true
          child.kill()
        }
      } else if (event.kind === 'end') files += 1
    })
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))

    const finish = (error: string | null): void => {
      clearInterval(timer)
      if (running[id] === entry) delete running[id]
      if (entry.cancelled) return
      flush()
      push('search.done', { id, files, matches: total, truncated, error })
    }
    child.on('error', (e: NodeJS.ErrnoException) => finish(e.code === 'ENOENT' ? 'ripgrep not found' : e.message))
    child.on('close', (code) => finish(code === 2 && !truncated ? stderr.trim().slice(0, 300) || 'ripgrep failed' : null))
  }

  return {
    run,
    cancel: kill,
    dispose: () => Object.keys(running).forEach(kill),
  }
}
```

Note: with `-F` rg never reports regex errors; with `regexp: true` and `(` rg exits 2 with "regex parse error" on stderr — the test regex accepts that.

- [ ] **Step 4: Wire** — `src/main/index.ts`: `const search = createSearchService({ rgPath, push: pushToAll, settings: () => config.current().settings.search })` (use the existing accessor name for current settings on `ConfigService`; check `src/main/config/service.ts`). Add `search` to `HandlerDeps`; handlers:
```ts
handle('search.run', async ({ id, spec, roots }) => { search.run(id, spec, roots); return ok(true as const) })
handle('search.cancel', async ({ id }) => { search.cancel(id); return ok(true as const) })
```
Dispose on `before-quit`.

- [ ] **Step 5: Run** `pnpm vitest run tests/unit/main/searchRun.test.ts && pnpm typecheck` — PASS. **Step 6: Commit** — `feat(search): ripgrep streaming service with batches, cap and cancel`

---

### Task 4: Replace in closed files with hash verification and undo ring

**Files:**
- Create: `src/main/search/replace.ts`
- Modify: `src/main/ipc/handlers.ts`, `src/main/index.ts`
- Test: `tests/unit/main/searchReplace.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ReplaceService = { replace: (plan: ReplacePlan) => Promise<ReplaceReport>; undoLast: () => Promise<ReplaceReport | null> }
  export const createReplaceService = (deps: { expected: ExpectedWrites; keep?: number }): ReplaceService
  ```
- Per file: `readTextFile(path)` → if `!ok` → skipped `readError`/`notFound`; if `file.hash !== plan.hash` → `hashMismatch`; split `text` on `\n` (text is already LF-normalised by `readTextFile`; the original EOL is `file.eol`); for each `{ line, skip }` apply `replaceInLine(lines[line-1], plan.spec, plan.replacement, plan.preserveCase, skip)`; if no line changed → not listed in `changed`; encode via `encodeLossless(restoreEol(joined, file.eol), file.encoding, file.bom)` → `encodingLossy` on failure; `expected.mark(path, hash)` (same helper `writeTextFile` uses so the watcher ignores our write) then `writeAtomically`. Pre-image `{ path, beforeBytes, afterHash }` kept per operation; ring of `keep` (5) operations. `undoLast` pops the newest op and for each file: current hash equals `afterHash` → write `beforeBytes` back (changed), else `hashMismatch`.

- [ ] **Step 1: Failing test** — `tests/unit/main/searchReplace.test.ts`

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import iconv from 'iconv-lite'
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { hashBytes } from '../../../src/main/fs/hash'
import { createReplaceService } from '../../../src/main/search/replace'
import { createExpectedWrites } from '../../../src/main/watch/expected'

const spec = { pattern: 'foo', regexp: false, caseSensitive: false, wholeWord: false, include: '', exclude: '' }
let dir: string
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'moru-replace-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (name: string, bytes: Buffer) => {
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return { path, hash: hashBytes(bytes) }
}

describe('replaceInFiles', () => {
  it('re-runs the regex on listed lines only, preserves CRLF/CP949, skips excluded matches and stale hashes', async () => {
    const a = write('a.txt', Buffer.from('foo 1\r\nfoo 2\r\nfoo Foo\r\n'))
    const k = write('k.txt', iconv.encode('한글 foo\n', 'cp949'))
    const stale = write('s.txt', Buffer.from('foo\n'))
    writeFileSync(stale.path, 'changed\n')
    const service = createReplaceService({ expected: createExpectedWrites() })

    const report = await service.replace({
      spec, replacement: 'bar', preserveCase: true,
      files: [
        { path: a.path, hash: a.hash, lines: [{ line: 1, skip: [] }, { line: 3, skip: [1] }] },
        { path: k.path, hash: k.hash, lines: [{ line: 1, skip: [] }] },
        { path: stale.path, hash: stale.hash, lines: [{ line: 1, skip: [] }] },
        { path: join(dir, 'missing.txt'), hash: 'x', lines: [{ line: 1, skip: [] }] },
      ],
    })

    expect(readFileSync(a.path, 'utf8')).toBe('bar 1\r\nfoo 2\r\nbar Foo\r\n')
    expect(iconv.decode(readFileSync(k.path), 'cp949')).toBe('한글 bar\n')
    expect(report.changed).toEqual([{ path: a.path, matches: 2 }, { path: k.path, matches: 1 }])
    expect(report.skipped.map((s) => s.reason).sort()).toEqual(['hashMismatch', 'notFound'])
  })

  it('undoLast restores only files whose hash still equals the post-replace hash', async () => {
    const a = write('a.txt', Buffer.from('foo\n'))
    const b = write('b.txt', Buffer.from('foo\n'))
    const service = createReplaceService({ expected: createExpectedWrites() })
    await service.replace({ spec, replacement: 'bar', preserveCase: false, files: [a, b].map((f) => ({ ...f, lines: [{ line: 1, skip: [] }] })) })
    writeFileSync(b.path, 'edited later\n')

    const undo = await service.undoLast()
    expect(readFileSync(a.path, 'utf8')).toBe('foo\n')
    expect(readFileSync(b.path, 'utf8')).toBe('edited later\n')
    expect(undo?.changed).toEqual([{ path: a.path, matches: 1 }])
    expect(undo?.skipped).toEqual([{ path: b.path, reason: 'hashMismatch' }])
    expect(await service.undoLast()).toBeNull()
  })
})
```
(Check the real constructor name in `src/main/watch/expected.ts` and adapt the import; the `writeTextFile` path in `src/main/fs/write.ts` shows how a write is announced to the watcher — reuse the same call.)

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `src/main/search/replace.ts`

```ts
import { readFile } from 'node:fs/promises'
import type { ReplacePlan, ReplaceReport } from '@shared/search'
import { replaceInLine } from '@shared/replaceText'
import { writeAtomically } from '../fs/atomic'
import { encodeLossless } from '../fs/encoding'
import { restoreEol } from '../fs/eol'
import { hashBytes } from '../fs/hash'
import { readTextFile } from '../fs/read'
import type { ExpectedWrites } from '../watch/expected'

type Skip = ReplaceReport['skipped'][number]
type PreImage = { readonly path: string; readonly before: Buffer; readonly afterHash: string }
type Operation = { readonly files: PreImage[] }

export type ReplaceService = {
  readonly replace: (plan: ReplacePlan) => Promise<ReplaceReport>
  readonly undoLast: () => Promise<ReplaceReport | null>
}

const currentHash = async (path: string): Promise<string | null> => {
  try {
    return hashBytes(await readFile(path))
  } catch {
    return null
  }
}

export const createReplaceService = ({ expected, keep = 5 }: { expected: ExpectedWrites; keep?: number }): ReplaceService => {
  const history: Operation[] = []

  const replaceFile = async (plan: ReplacePlan, file: ReplacePlan['files'][number]): Promise<{ changed?: { path: string; matches: number }; skipped?: Skip; pre?: PreImage }> => {
    const opened = await readTextFile(file.path)
    if (!opened.ok) return { skipped: { path: file.path, reason: opened.error.kind === 'notFound' ? 'notFound' : 'readError' } }
    if (opened.value.hash !== file.hash) return { skipped: { path: file.path, reason: 'hashMismatch' } }

    const lines = opened.value.text.split('\n')
    let matches = 0
    for (const { line, skip } of file.lines) {
      const source = lines[line - 1]
      if (source === undefined) continue
      const result = replaceInLine(source, plan.spec, plan.replacement, plan.preserveCase, skip)
      if (!result) continue
      lines[line - 1] = result.text
      matches += result.edits.length
    }
    if (matches === 0) return {}

    const encoded = encodeLossless(restoreEol(lines.join('\n'), opened.value.eol), opened.value.encoding, opened.value.bom)
    if (!encoded.ok) return { skipped: { path: file.path, reason: 'encodingLossy' } }

    const before = await readFile(file.path)
    const afterHash = hashBytes(encoded.bytes)
    try {
      expected.mark(file.path, afterHash)
      await writeAtomically(file.path, encoded.bytes)
    } catch {
      return { skipped: { path: file.path, reason: 'writeError' } }
    }
    return { changed: { path: file.path, matches }, pre: { path: file.path, before, afterHash } }
  }

  const replace = async (plan: ReplacePlan): Promise<ReplaceReport> => {
    const results = await Promise.all(plan.files.map((f) => replaceFile(plan, f)))
    const op: Operation = { files: results.flatMap((r) => (r.pre ? [r.pre] : [])) }
    if (op.files.length > 0) history.splice(0, Math.max(0, history.length + 1 - keep)), history.push(op)
    return {
      changed: results.flatMap((r) => (r.changed ? [r.changed] : [])),
      skipped: results.flatMap((r) => (r.skipped ? [r.skipped] : [])),
    }
  }

  const undoLast = async (): Promise<ReplaceReport | null> => {
    const op = history.pop()
    if (!op) return null
    const report: ReplaceReport = { changed: [], skipped: [] }
    for (const pre of op.files) {
      if ((await currentHash(pre.path)) !== pre.afterHash) {
        report.skipped.push({ path: pre.path, reason: 'hashMismatch' })
        continue
      }
      expected.mark(pre.path, hashBytes(pre.before))
      await writeAtomically(pre.path, pre.before)
      report.changed.push({ path: pre.path, matches: 1 })
    }
    return report
  }

  return { replace, undoLast }
}
```
Adapt `expected.mark` to the real `ExpectedWrites` API (see how `writeTextFile`'s `onWritten` callback is wired in `handlers.ts` — the handler calls `expected.<method>(path, hash)`; call the same). `readTextFile`'s error kinds: check `OpenError` in `src/shared/ipc.ts` for the not-found kind name.

- [ ] **Step 4: Wire** — `createReplaceService({ expected })` in `src/main/index.ts`; handlers:
```ts
handle('search.replace', async (plan) => ok(await replace.replace(plan)))
handle('search.undoLast', async () => ok(await replace.undoLast()))
```
(`ok(null)` for the nullable: if `ok()` rejects null under the ts-belt constraint, wrap the response as `z.object({ report: ReplaceReport.nullable() })` and return `ok({ report })` — apply the same shape in the contract and in Task 6's renderer call.)

- [ ] **Step 5: Run** unit + typecheck — PASS. **Step 6: Commit** — `feat(search): replace in closed files with hash verification and undo ring`

---

### Task 5: Renderer search state (tree, exclusions, dirty correction, preview)

**Files:**
- Create: `src/renderer/src/search/state.ts`, `src/renderer/src/search/local.ts`
- Test: `tests/unit/renderer/searchState.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // state.ts
  export type SearchStatus = 'idle' | 'running' | 'done' | 'error'
  export type FileResult = { readonly path: string; readonly matches: readonly SearchMatch[]; readonly source: 'disk' | 'buffer' }
  export type SearchState = {
    readonly id: string
    readonly spec: SearchSpec
    readonly replacement: string
    readonly preserveCase: boolean
    readonly status: SearchStatus
    readonly error: string | null
    readonly files: readonly FileResult[]        // insertion order = arrival order
    readonly total: number
    readonly truncated: boolean
    readonly excluded: Readonly<Record<string, true>>   // keys: `${path}` (whole file) or `${path}:${line}:${index}`
    readonly collapsed: Readonly<Record<string, true>>
  }
  export const emptySearch = (id: string, spec?: Partial<SearchSpec>): SearchState
  export const appendBatch = (s: SearchState, matches: readonly SearchMatch[]): SearchState        // groups by path, appends; ignores paths whose source is 'buffer'
  export const replaceFileResults = (s: SearchState, path: string, matches: readonly SearchMatch[]): SearchState  // source 'buffer'; removes the file when matches is empty
  export const matchKey = (m: SearchMatch, index: number): string      // `${path}:${line}:${index}` where index is the match's ordinal within its line
  export const toggleExcluded = (s: SearchState, key: string): SearchState
  export const isIncluded = (s: SearchState, m: SearchMatch, index: number): boolean   // false when file key or match key excluded
  export const previewOf = (s: SearchState, m: SearchMatch): string | null            // replacement text for this match (preserveCase applied) or null when replacement is '' / regex invalid
  export const includedCount = (s: SearchState): { files: number; matches: number }
  export const planFor = (s: SearchState, hashes: Readonly<Record<string, string>>): ReplacePlan  // closed files only (those present in `hashes`)
  export const bufferEdits = (s: SearchState, path: string, state: EditorState): { from: number; to: number; insert: string }[]  // for open buffers, absolute offsets
  // local.ts
  export const searchState = (spec: SearchSpec, path: string, state: EditorState): SearchMatch[]  // via toRegExp + matchesInLine per line, cap 10k
  ```
- Ordinal index within a line: matches for the same `(path, line)` are ordered by `from`; index = position in that order. `previewOf` computes it with `matchesInLine(m.text, re)` and picks the match whose `from === m.from`.

- [ ] **Step 1: Failing tests** — `tests/unit/renderer/searchState.test.ts`

```ts
import { EditorState } from '@codemirror/state'
import { describe, it, expect } from 'vitest'
import { searchState } from '../../../src/renderer/src/search/local'
import { appendBatch, bufferEdits, emptySearch, includedCount, isIncluded, matchKey, planFor, previewOf, replaceFileResults, toggleExcluded } from '../../../src/renderer/src/search/state'

const spec = { pattern: 'foo', regexp: false, caseSensitive: false, wholeWord: false, include: '', exclude: '' }
const m = (path: string, line: number, text: string, from: number) => ({ path, line, text, from, to: from + 3 })

describe('search state', () => {
  it('groups batches by path in arrival order and keeps buffer-sourced files authoritative', () => {
    let s = emptySearch('q', spec)
    s = appendBatch(s, [m('/a', 1, 'foo foo', 0), m('/a', 1, 'foo foo', 4), m('/b', 2, 'x foo', 2)])
    expect(s.files.map((f) => [f.path, f.matches.length, f.source])).toEqual([['/a', 2, 'disk'], ['/b', 1, 'disk']])
    s = replaceFileResults(s, '/a', [m('/a', 5, 'FOO', 0)])
    s = appendBatch(s, [m('/a', 9, 'foo', 0)])
    expect(s.files[0]).toMatchObject({ path: '/a', source: 'buffer', matches: [m('/a', 5, 'FOO', 0)] })
    expect(replaceFileResults(s, '/b', []).files.map((f) => f.path)).toEqual(['/a'])
    expect(s.total).toBe(2)
  })

  it('excludes by file or by match and previews with case preservation', () => {
    let s = { ...appendBatch(emptySearch('q', spec), [m('/a', 1, 'foo Foo', 0), m('/a', 1, 'foo Foo', 4), m('/b', 1, 'foo', 0)]), replacement: 'bar', preserveCase: true }
    expect(previewOf(s, m('/a', 1, 'foo Foo', 4))).toBe('Bar')
    expect(matchKey(m('/a', 1, 'foo Foo', 4), 1)).toBe('/a:1:1')
    s = toggleExcluded(s, '/a:1:1')
    expect(isIncluded(s, m('/a', 1, 'foo Foo', 4), 1)).toBe(false)
    expect(isIncluded(s, m('/a', 1, 'foo Foo', 0), 0)).toBe(true)
    s = toggleExcluded(s, '/b')
    expect(includedCount(s)).toEqual({ files: 1, matches: 1 })
    expect(planFor(s, { '/a': 'h1', '/b': 'h2' })).toEqual({
      spec, replacement: 'bar', preserveCase: true,
      files: [{ path: '/a', hash: 'h1', lines: [{ line: 1, skip: [1] }] }],
    })
    expect(previewOf({ ...s, replacement: '' }, m('/a', 1, 'foo Foo', 0))).toBeNull()
  })

  it('computes absolute buffer edits and local matches', () => {
    const state = EditorState.create({ doc: '한 foo\nfoo x foo\n' })
    const local = searchState(spec, '/a', state)
    expect(local).toEqual([m('/a', 1, '한 foo', 2), m('/a', 2, 'foo x foo', 0), m('/a', 2, 'foo x foo', 6)])
    const s = { ...replaceFileResults(emptySearch('q', spec), '/a', local), replacement: 'b', preserveCase: false }
    expect(bufferEdits(toggleExcluded(s, '/a:2:0'), '/a', state)).toEqual([{ from: 2, to: 5, insert: 'b' }, { from: 12, to: 15, insert: 'b' }])
  })
})
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `src/renderer/src/search/local.ts`

```ts
import type { EditorState } from '@codemirror/state'
import { matchesInLine, toRegExp } from '@shared/replaceText'
import type { SearchMatch, SearchSpec } from '@shared/search'

export const searchState = (spec: SearchSpec, path: string, state: EditorState, cap = 10_000): SearchMatch[] => {
  const re = toRegExp(spec)
  if (!re) return []
  const out: SearchMatch[] = []
  for (let n = 1; n <= state.doc.lines && out.length < cap; n++) {
    const line = state.doc.line(n)
    for (const hit of matchesInLine(line.text, re)) out.push({ path, line: n, text: line.text, from: hit.from, to: hit.to })
  }
  return out
}
```

`src/renderer/src/search/state.ts` — implement the Interfaces with ts-belt (`A`, `D`) where natural:
```ts
import { A, D } from '@mobily/ts-belt'
import type { EditorState } from '@codemirror/state'
import { expandReplacement, matchesInLine, preserveCaseOf, toRegExp } from '@shared/replaceText'
import type { ReplacePlan, SearchMatch, SearchSpec } from '@shared/search'

export type SearchStatus = 'idle' | 'running' | 'done' | 'error'
export type FileResult = { readonly path: string; readonly matches: readonly SearchMatch[]; readonly source: 'disk' | 'buffer' }
export type SearchState = { /* as in Interfaces */ }

const defaultSpec: SearchSpec = { pattern: '', regexp: false, caseSensitive: false, wholeWord: false, include: '', exclude: '' }

export const emptySearch = (id: string, spec: Partial<SearchSpec> = {}): SearchState => ({
  id, spec: { ...defaultSpec, ...spec }, replacement: '', preserveCase: false, status: 'idle', error: null,
  files: [], total: 0, truncated: false, excluded: {}, collapsed: {},
})

const recount = (s: SearchState): SearchState => ({ ...s, total: s.files.reduce((n, f) => n + f.matches.length, 0) })

export const appendBatch = (s: SearchState, matches: readonly SearchMatch[]): SearchState => {
  const files = [...s.files]
  const indexOf: Record<string, number> = Object.fromEntries(files.map((f, i) => [f.path, i]))
  for (const m of matches) {
    const at = indexOf[m.path]
    if (at === undefined) {
      indexOf[m.path] = files.length
      files.push({ path: m.path, matches: [m], source: 'disk' })
    } else if (files[at]!.source === 'disk') {
      files[at] = { ...files[at]!, matches: [...files[at]!.matches, m] }
    }
  }
  return recount({ ...s, files })
}

export const replaceFileResults = (s: SearchState, path: string, matches: readonly SearchMatch[]): SearchState => {
  const without = s.files.filter((f) => f.path !== path)
  const at = s.files.findIndex((f) => f.path === path)
  if (matches.length === 0) return recount({ ...s, files: without })
  const entry: FileResult = { path, matches, source: 'buffer' }
  const files = at < 0 ? [...without, entry] : [...s.files.slice(0, at), entry, ...s.files.slice(at + 1)]
  return recount({ ...s, files })
}

export const matchKey = (m: SearchMatch, index: number): string => `${m.path}:${m.line}:${index}`

export const toggleExcluded = (s: SearchState, key: string): SearchState =>
  ({ ...s, excluded: s.excluded[key] ? D.deleteKey(s.excluded, key) : { ...s.excluded, [key]: true } })

export const isIncluded = (s: SearchState, m: SearchMatch, index: number): boolean => !s.excluded[m.path] && !s.excluded[matchKey(m, index)]

const ordinalOf = (file: FileResult, m: SearchMatch): number =>
  file.matches.filter((x) => x.line === m.line && x.from < m.from).length

export const previewOf = (s: SearchState, m: SearchMatch): string | null => {
  if (s.replacement === '') return null
  const re = toRegExp(s.spec)
  if (!re) return null
  const hit = matchesInLine(m.text, re).find((h) => h.from === m.from)
  if (!hit) return null
  const expanded = expandReplacement(hit.exec, s.replacement, s.spec.regexp)
  return s.preserveCase ? preserveCaseOf(hit.exec[0], expanded) : expanded
}

const includedMatches = (s: SearchState, file: FileResult): { m: SearchMatch; index: number }[] =>
  file.matches.map((m) => ({ m, index: ordinalOf(file, m) })).filter(({ m, index }) => isIncluded(s, m, index))

export const includedCount = (s: SearchState): { files: number; matches: number } => {
  const perFile = s.files.map((f) => includedMatches(s, f).length).filter((n) => n > 0)
  return { files: perFile.length, matches: A.reduce(perFile, 0, (a, b) => a + b) }
}

export const planFor = (s: SearchState, hashes: Readonly<Record<string, string>>): ReplacePlan => ({
  spec: s.spec, replacement: s.replacement, preserveCase: s.preserveCase,
  files: s.files
    .filter((f) => hashes[f.path] !== undefined && includedMatches(s, f).length > 0)
    .map((f) => {
      const lines = A.uniq(f.matches.map((m) => m.line))
      return {
        path: f.path, hash: hashes[f.path]!,
        lines: lines.map((line) => ({
          line,
          skip: f.matches.filter((m) => m.line === line).map((m) => ordinalOf(f, m)).filter((i) => !isIncluded(s, f.matches.find((m) => m.line === line && ordinalOf(f, m) === i)!, i)),
        })),
      }
    }),
})

export const bufferEdits = (s: SearchState, path: string, state: EditorState): { from: number; to: number; insert: string }[] => {
  const file = s.files.find((f) => f.path === path)
  if (!file) return []
  return includedMatches(s, file).flatMap(({ m }) => {
    const insert = previewOf(s, m)
    if (insert === null) return []
    const base = state.doc.line(m.line).from
    return [{ from: base + m.from, to: base + m.to, insert }]
  })
}
```
(`skip` in `planFor` must list the ordinal indexes that are **excluded**; write it as: for each line, `ordinals = matches on that line sorted by from → index`, `skip = ordinals filtered !isIncluded`. Simplify the one-liner above accordingly when implementing.)

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `feat(search): renderer search state, dirty-buffer correction and replace planning`

---

### Task 6: Workspace integration — `search` tab kind, run, replace, undo, session

**Files:**
- Modify: `src/renderer/src/app/workspace.ts`, `src/shared/session.ts`, `src/renderer/src/app/registerCommands.ts`, `src/renderer/src/keymap/defaults.ts`, `src/main/menu.ts`, `src/renderer/src/testHooks.ts`
- Test: covered by Task 7 E2E; `tests/unit/shared/session.test.ts` gains one search-tab round-trip case.

**Interfaces:**
- `Tab` gains `| { readonly id: TabId; readonly kind: 'search'; readonly searchId: string }`.
- `WorkspaceState` gains `searches: Record<string, SearchState>`.
- Workspace API:
  ```ts
  openSearch(initial?: Partial<SearchSpec>): void            // focuses the existing search tab in this window or creates one; seeds pattern from the primary selection when non-empty and no pattern given
  setSearchSpec(searchId: string, patch: Partial<SearchSpec>): void
  setSearchReplacement(searchId: string, replacement: string, preserveCase?: boolean): void
  runSearch(searchId: string): Promise<void>                  // invoke search.run with roots [projectRoot] (or the active file's dir when no root); status 'running'; resets files/excluded; then re-runs the spec locally over every dirty open buffer and calls replaceFileResults
  toggleSearchExcluded(searchId: string, key: string): void
  toggleSearchCollapsed(searchId: string, path: string): void
  openMatch(m: SearchMatch, preview: boolean): Promise<void>  // previewFile/openFile then select [from,to] on that line (gotoLine + selection)
  replaceAll(searchId: string): Promise<{ closed: ReplaceReport; buffers: number }>
  undoReplace(): Promise<ReplaceReport | null>
  ```
- Push handling (in workspace, registered once): `search.batch` → `appendBatch` for `state.searches[id]` but skip paths that are open **dirty** buffers (already authoritative) — implement by checking `bufferByPath(path)` dirty before append; `search.done` → status `done|error`, `truncated`, `error`.
- Session: `SearchTabSnapshot = z.object({ kind: z.literal('search'), spec: SearchSpec, replacement: z.string() })` in the pane tab union; restore recreates the tab with `emptySearch(newId, spec)` (no auto-run).
- Commands: `search.project` (`mod+shift+f`, title "Find in Files…"), `search.undoReplace` (title "Undo Replace in Files"), `search.run` (`when: 'searchFocus'` — Enter inside the pattern input handles this directly in the UI, command exists for the palette). Menu: Find → separator → "Find in Files…" `CmdOrCtrl+Shift+F`, "Undo Replace in Files".
- Test hooks: `searchState(): { status, total, files: { path, count, source }[] } | null` for the active search tab; `searchTabs(): number`.

- [ ] **Step 1: Session schema + unit test** — add `SearchTabSnapshot` to `src/shared/session.ts` union; test case in `tests/unit/shared/session.test.ts`:
```ts
it('round-trips a search tab', () => {
  const snap = { kind: 'search', spec: { pattern: 'x', regexp: true, caseSensitive: false, wholeWord: false, include: '', exclude: '' }, replacement: 'y' }
  expect(PaneSnapshot.parse({ id: 'p', tabs: [snap], active: null }).tabs[0]).toEqual(snap)
})
```
(Match the real `PaneSnapshot` field names from the file.)

- [ ] **Step 2: Workspace** — add the tab kind, store slice, API and push handlers. Key fragments:

```ts
const openSearch = (initial: Partial<SearchSpec> = {}): void => {
  const existing = D.values(state.tabs).find((t) => t.kind === 'search')
  const seed = initial.pattern ?? selectedTextForSearch()
  if (existing?.kind === 'search') {
    const leaf = leafOfTab(currentTree, existing.id)
    if (leaf) setTree(setActiveTab(currentTree, leaf.id, existing.id))
    if (seed) setState('searches', existing.searchId, 'spec', 'pattern', seed)
    return
  }
  const searchId = `s${Date.now().toString(36)}`
  setState('searches', searchId, emptySearch(searchId, { ...initial, ...(seed ? { pattern: seed } : {}) }))
  addTabToActive({ id: nextTabId(), kind: 'search', searchId })
}

const selectedTextForSearch = (): string | null => {
  const view = activeView()
  if (!view) return null
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to)
  return from !== to && !text.includes('\n') ? text : null
}

const runSearch = async (searchId: string): Promise<void> => {
  const current = state.searches[searchId]
  if (!current || current.spec.pattern === '') return
  const roots = state.projectRoot ? [state.projectRoot] : [dirnameOf(activeBuffer()?.meta?.path ?? '') ?? '.']
  setState('searches', searchId, { ...emptySearch(searchId, current.spec), replacement: current.replacement, preserveCase: current.preserveCase, status: 'running' })
  const dirtyLocal = D.values(buffers).filter((b) => b.meta && isDirty(b))
  for (const b of dirtyLocal) {
    setState('searches', searchId, (s) => replaceFileResults(s, b.meta!.path, searchState(current.spec, b.meta!.path, b.state)))
  }
  await invoke('search.run', { id: searchId, spec: current.spec, roots })
}

onPush('search.batch', ({ id, matches }) => {
  if (!state.searches[id]) return
  const fresh = matches.filter((m) => { const b = bufferByPath(m.path); return !(b && isDirty(b)) })
  setState('searches', id, (s) => appendBatch(s, fresh))
})
onPush('search.done', ({ id, truncated, error }) => {
  if (!state.searches[id]) return
  setState('searches', id, (s) => ({ ...s, status: error ? 'error' : 'done', error, truncated }))
})

const openMatch = async (m: SearchMatch, preview: boolean): Promise<void> => {
  const opened = preview ? await previewFile(m.path) : await openFile(m.path)
  if (!opened) return
  if (!preview) commitPreview()
  const view = activeView()
  if (!view) return
  const line = view.state.doc.line(Math.min(m.line, view.state.doc.lines))
  const from = Math.min(line.from + m.from, line.to)
  const to = Math.min(line.from + m.to, line.to)
  view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
}

const replaceAll = async (searchId: string): Promise<{ closed: ReplaceReport; buffers: number }> => {
  const s = state.searches[searchId]
  if (!s) return { closed: { changed: [], skipped: [] }, buffers: 0 }
  let touched = 0
  const hashes: Record<string, string> = {}
  for (const f of s.files) {
    const buffer = bufferByPath(f.path)
    if (buffer) {
      const view = viewOfBuffer(buffer.id)     // find the pane showing it, else apply to buffer.state and putBuffer
      const edits = bufferEdits(s, f.path, buffer.state)
      if (edits.length > 0) {
        applyToBuffer(buffer, { changes: edits, userEvent: 'search.replace' })
        touched += 1
      }
    } else if (f.source === 'disk' && f.matches.length > 0) {
      hashes[f.path] = await hashOf(f.path)   // fs.open → hash (search-time hash was not captured; open once here, before planning, and use it — main re-verifies against it)
    }
  }
  const plan = planFor(s, hashes)
  const closed = plan.files.length > 0 ? R.getWithDefault(await invoke('search.replace', plan), { changed: [], skipped: [] }) : { changed: [], skipped: [] }
  setState('status', `Replaced in ${closed.changed.length} file(s) on disk, ${touched} open buffer(s)${closed.skipped.length ? `, skipped ${closed.skipped.length}` : ''}`)
  return { closed, buffers: touched }
}
```
Implementation notes:
  - `applyToBuffer(buffer, spec)`: if a view currently shows the buffer, `view.dispatch(spec)`; otherwise `putBuffer({ ...buffer, state: buffer.state.update(spec).state })` and mark dirty via the existing dirty-tracking path (whatever `EditorHost`'s update listener does — look at how `dirtySync` learns about changes; if it hooks `view.updateListener`, call the same `onBufferChanged(buffer.id)` helper).
  - "search-time hash": the plan says main verifies the hash captured at search time; rg does not report hashes, so capture it right before planning by `fs.open` (cheap for a handful of files) and treat that as the reference; main re-reads and compares — a file modified between those two reads is still caught (`hashMismatch`). Document this in the report.
  - Open **clean** buffers: apply as a transaction (not saved) — the buffer becomes dirty, matching ST3.
  - Do not `fs.watch` anything new; changed closed files are not open.
- `undoReplace`: `invoke('search.undoLast')` → status message with counts; `null` → "Nothing to undo".

- [ ] **Step 3: Commands, keys, menu, hooks** — as in Interfaces. Context: add `searchFocus` to `WhenContext` (true when `document.activeElement` is inside `[data-testid="search-tab"]`) so `mod+f`/`Escape` inside the search inputs are not captured by editor bindings (reuse the `findFocused` pattern).

- [ ] **Step 4:** `pnpm typecheck && pnpm vitest run tests/unit/shared/session.test.ts` — PASS. **Step 5: Commit** — `feat(search): search tab kind, run/replace/undo actions, session snapshot`

---

### Task 7: `SearchHost` UI + E2E

**Files:**
- Create: `src/renderer/src/ui/search/SearchHost.tsx`
- Modify: `src/renderer/src/ui/layout/PaneView.tsx`, `src/renderer/src/ui/tabs/TabStrip.tsx`, `src/renderer/src/style.css`
- Test: `tests/e2e/search.spec.ts`

**Interfaces / UI contract (test ids):**
- Container `search-tab`; inputs `search-pattern`, `search-replace`, `search-include`, `search-exclude`; toggles `search-toggle-regex|case|word|preserve`; `search-status` text (`running…` / `N matches in M files` / `error: …` / `10000+ matches (truncated)`); tree: `search-file` rows (with `search-file-toggle` checkbox and chevron), `search-match` rows (checkbox `search-match-toggle`, line number, text with `<mark>` on the match and, when a replacement is set, `<del>old</del><ins>new</ins>`); buttons `search-replace-all`, `search-undo`.
- Keys inside the pattern input: `Enter` → `runSearch`; `Escape` → focus the editor of the active pane; inside the replace input `Enter` also runs.
- Clicking a match row → `openMatch(m, true)` (preview); double-click or `Enter` on a focused row → `openMatch(m, false)`.
- Tab title: `Find: <pattern>` (or `Find in Files` when empty).

- [ ] **Step 1: Write the E2E** — `tests/e2e/search.spec.ts`

```ts
import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const status = (page: Page) => page.getByTestId('search-status')
const summary = (page: Page) => page.evaluate(() => window.__moruTest!.searchState())

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'moru-search-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'a.ts'), 'const foo = 1\nfoo(foo)\n')
  writeFileSync(join(root, 'src', 'b.ts'), 'export const Foo = "foo"\n')
  writeFileSync(join(root, 'notes.md'), '# nothing\n')
  return root
}

test('streams results into a tree, corrects dirty buffers, opens a match', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root, MORU_TEST_OPEN: join(root, 'src', 'a.ts') })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('foo ')                       // a.ts buffer is now dirty: 4 matches instead of 3

  await page.keyboard.press(`${mod}+Shift+f`)
  await expect(page.getByTestId('search-pattern')).toBeFocused()
  await page.keyboard.type('foo')
  await page.keyboard.press('Enter')
  await expect(status(page)).toHaveText('6 matches in 2 files')
  const s = await summary(page)
  expect(s?.files).toEqual([
    { path: join(root, 'src', 'a.ts'), count: 4, source: 'buffer' },
    { path: join(root, 'src', 'b.ts'), count: 2, source: 'disk' },
  ])
  await expect(page.getByTestId('search-match')).toHaveCount(6)

  await page.getByTestId('search-match').nth(4).click()  // b.ts: Foo
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'src', 'b.ts'))
  expect((await page.evaluate(() => window.__moruTest!.selections()))[0]).toEqual({ from: 13, to: 16 })
  await app.close()
})

test('replace all edits open buffers without saving, rewrites closed files, and undo restores them', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root, MORU_TEST_OPEN: join(root, 'src', 'a.ts') })
  await page.keyboard.press(`${mod}+Shift+f`)
  await page.keyboard.type('foo')
  await page.getByTestId('search-toggle-preserve').click()
  await page.getByTestId('search-replace').fill('bar')
  await page.keyboard.press('Enter')
  await expect(status(page)).toHaveText('5 matches in 2 files')
  await expect(page.locator('[data-testid="search-match"] ins').first()).toHaveText('bar')

  await page.getByTestId('search-match-toggle').nth(3).click()   // exclude b.ts "Foo"
  await page.getByTestId('search-replace-all').click()

  await expect.poll(() => readFileSync(join(root, 'src', 'b.ts'), 'utf8')).toBe('export const Foo = "bar"\n')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('const bar = 1\nbar(bar)\n')
  expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toBe('const foo = 1\nfoo(foo)\n')          // open buffer not saved
  expect(await page.evaluate(() => window.__moruTest!.dirty())).toBe(true)

  await page.evaluate(() => window.__moruTest!.runCommand('search.undoReplace'))
  await expect.poll(() => readFileSync(join(root, 'src', 'b.ts'), 'utf8')).toBe('export const Foo = "foo"\n')
  await app.close()
})

test('search tab survives a session restore with its query', async () => {
  const root = project()
  const first = await launchApp({ MORU_TEST_ROOT: root })
  await first.page.keyboard.press(`${mod}+Shift+f`)
  await first.page.keyboard.type('foo')
  await first.page.keyboard.press('Enter')
  await expect(status(first.page)).toContainText('matches')
  await first.page.evaluate(() => window.__moruTest!.snapshotNow())
  await first.app.close()

  const second = await launchApp({ MORU_TEST_ROOT: root }, { userData: first.userData })
  await expect(second.page.getByTestId('search-pattern')).toHaveValue('foo')
  expect(await second.page.evaluate(() => window.__moruTest!.searchTabs())).toBe(1)
  await second.app.close()
})
```
(`snapshotNow` exists from M3a; `dirty()` and `doc()` refer to the active buffer — after Replace All the active tab must still be `a.ts`: `openSearch` adds the search tab to the active pane and activates it, so before asserting `doc()`, click the `a.ts` tab or use `runCommand('tab.previous')`; add that step when implementing.)

- [ ] **Step 2: Run** `pnpm exec playwright test tests/e2e/search.spec.ts` — FAIL (no UI).

- [ ] **Step 3: Implement** `SearchHost.tsx` — Solid component bound to `props.ws.state.searches[searchId]`. Structure:

```tsx
export const SearchHost = (props: { ws: Workspace; searchId: string }) => {
  const s = () => props.ws.state.searches[props.searchId]
  const re = createMemo(() => (s() ? toRegExp(s()!.spec) : null))
  const run = () => void props.ws.runSearch(props.searchId)
  const statusText = () => { const x = s(); if (!x) return ''
    if (x.status === 'running') return 'running…'
    if (x.status === 'error') return `error: ${x.error}`
    if (x.status === 'idle') return ''
    const n = x.truncated ? '10000+' : String(x.total)
    return `${n} match${x.total === 1 ? '' : 'es'} in ${x.files.length} file${x.files.length === 1 ? '' : 's'}${x.truncated ? ' (truncated)' : ''}` }
  return (
    <div class="search-tab" data-testid="search-tab">
      <div class="search-form">
        <input data-testid="search-pattern" value={s()?.spec.pattern ?? ''} onInput={(e) => props.ws.setSearchSpec(props.searchId, { pattern: e.currentTarget.value })}
               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); run() } if (e.key === 'Escape') props.ws.activeView()?.focus() }} placeholder="Find" spellcheck={false} />
        {/* toggles: regex / case / word / preserve → setSearchSpec / setSearchReplacement */}
        <input data-testid="search-replace" ... placeholder="Replace" />
        <input data-testid="search-include" ... placeholder="Include: *.ts, src/**" />
        <input data-testid="search-exclude" ... placeholder="Exclude" />
        <button data-testid="search-replace-all" disabled={!s() || s()!.status !== 'done' || s()!.replacement === ''} onClick={() => void props.ws.replaceAll(props.searchId)}>Replace All</button>
        <button data-testid="search-undo" onClick={() => void props.ws.undoReplace()}>Undo Replace in Files</button>
        <span class="search-status" data-testid="search-status">{statusText()}</span>
      </div>
      <div class="search-results">
        <For each={s()?.files ?? []}>{(file) => (
          <div class="search-file">
            <div class="search-file-row" data-testid="search-file">
              <input type="checkbox" data-testid="search-file-toggle" checked={!s()!.excluded[file.path]} onChange={() => props.ws.toggleSearchExcluded(props.searchId, file.path)} />
              <span class="chevron" onClick={() => props.ws.toggleSearchCollapsed(props.searchId, file.path)}>{s()!.collapsed[file.path] ? '▸' : '▾'}</span>
              <span class="search-file-path">{relTo(props.ws.state.projectRoot, file.path)}</span>
              <span class="search-file-count">{file.matches.length}{file.source === 'buffer' ? ' •' : ''}</span>
            </div>
            <Show when={!s()!.collapsed[file.path]}>
              <For each={file.matches}>{(m) => { const index = () => ordinalIn(file, m); const key = () => matchKey(m, index()); return (
                <div class="search-match" data-testid="search-match" classList={{ excluded: !isIncluded(s()!, m, index()) }}
                     onClick={() => void props.ws.openMatch(m, true)} onDblClick={() => void props.ws.openMatch(m, false)}>
                  <input type="checkbox" data-testid="search-match-toggle" checked={isIncluded(s()!, m, index())} onClick={(e) => e.stopPropagation()} onChange={() => props.ws.toggleSearchExcluded(props.searchId, key())} />
                  <span class="search-line">{m.line}</span>
                  <span class="search-text">{m.text.slice(0, m.from)}
                    <Show when={previewOf(s()!, m)} fallback={<mark>{m.text.slice(m.from, m.to)}</mark>}>{(p) => <><del>{m.text.slice(m.from, m.to)}</del><ins>{p()}</ins></>}</Show>
                    {m.text.slice(m.to)}</span>
                </div>) }}</For>
            </Show>
          </div>)}</For>
      </div>
    </div>
  )
}
```
Export `ordinalIn` from `search/state.ts` (it is `ordinalOf`). Long lines: clip `m.text` to ±120 chars around the match for display (compute `head`/`tail` slices; never mutate offsets used for actions). Render at most 2,000 match rows (`files` flattened) and show "… N more" to keep the tree light.

- PaneView: `searchTab()` accessor like `diffTab()`; hide `EditorHost` when a search tab is active; `<Show when={searchTab()}>{(t) => <SearchHost ws={props.ws} searchId={t().searchId} />}</Show>`; exclude search tabs from the `FindPanel` condition. TabStrip title for `search` kind.
- CSS: `.search-tab { display:flex; flex-direction:column; height:100%; }`, results `overflow:auto`, `.search-match.excluded { opacity:.5 }`, `del { color: var(--danger) } ins { color: var(--accent); text-decoration: none }`, `mark { background: var(--match-bg) }` — reuse existing theme variables from `style.css`.
- Focus: `openSearch` focuses `search-pattern` after mount (queueMicrotask). `searchFocus` context true while focus is inside `.search-tab`.

- [ ] **Step 4: Run** `pnpm exec playwright test tests/e2e/search.spec.ts` — PASS. Then `pnpm check` — all green (unit + 72 E2E).

- [ ] **Step 5: Commit** — `feat(search): Find in Files tab with streaming tree, replace preview, replace all and undo`

---

### Task 8: Report

- [ ] Write `docs/superpowers/reports/m4-global-search.md` in the format of `m3b-find-replace.md`: run date, verification line (typecheck / unit / E2E counts), results table per area, "구현 중 발견한 것" (rg byte offsets vs UTF-16; `-F` never errors; hash reference captured at plan time; open buffers not saved), decisions (single search tab per window; skip semantics; cap 10k; `search.encoding`), and "M5로 넘기는 것" (markdown).
- [ ] Update the milestone table in the spec? No — the spec stays; reports track progress.
- [ ] Commit — `docs: M4 global search report`

---

## Self-Review

- Spec coverage: rg stream ✓ (T3), tree + counts ✓ (T5/T7), new query kills previous ✓ (T3 `kill(id)`), dirty correction ✓ (T5/T6), click → open + select ✓ (T6 `openMatch`), preview tab browsing ✓ (`openMatch(m, true)`), replace preview `old → new` ✓ (T7), exclusion per file/match ✓ (T5), closed files: hash verify + regex re-run + atomic + pre-image ✓ (T4), open buffers: transaction, not saved ✓ (T6), global undo 5 ops ✓ (T4), `search.encoding` ✓ (T1/T2), rg 없음 → done with error → status shows it ✓ (T3/T7), 1만 파일 픽스처 ✓ (T3).
- Placeholders: T6 uses named helpers (`applyToBuffer`, `viewOfBuffer`, `hashOf`) that the implementer must map onto existing workspace helpers — each is described with what to reuse. T7 sketches the JSX; all test ids are enumerated.
- Type consistency: `SearchMatch{path,line,text,from,to}` used identically in T2/T3/T5/T6/T7; `ReplacePlan.files[].lines[].skip` = excluded ordinals in T4 and T5; `ReplaceReport` shape shared.
