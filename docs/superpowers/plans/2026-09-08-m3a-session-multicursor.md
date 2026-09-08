# M3a Session / Hot Exit and Multi-Cursor Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full hot exit: every window's layout, tabs, selections, scroll positions and undo histories come back after quit or SIGKILL, paired with the dirty store; plus the Sublime multi-cursor commands CodeMirror does not ship (split selection into lines, add cursor above/below, skip occurrence).

**Architecture:** The renderer serialises a `WindowSnapshot` (pane tree, tabs, per-buffer `{ path | untitledId, format, hash, docHash, selection, scrollTop, history }`, terminal cwd, sidebar, project root) 500 ms after any relevant change and on `beforeunload`, over a fire-and-forget `session.save` channel; main merges snapshots per `windowId` into `userData/session.json` (atomic write) together with window bounds and a `cleanExit` flag. On startup main opens one window per saved snapshot (CLI paths/root go to the first) and hands each window its snapshot in `app.bootstrap`. The renderer rebuilds the tree, then restores tabs by the spec table, using the dirty store for unsaved text and re-attaching undo history only when the text hash matches the one the history was captured against.

**Tech Stack:** CodeMirror `EditorState.toJSON/fromJSON` with `historyField`, zod, existing atomic write, existing dirty store.

**Spec:** §4.6 세션 / Hot exit (스키마·저장 시점·복원 규칙), §5.2 멀티커서 커맨드 표, §8 M3 수용 기준 (SIGKILL 복원 E2E).

## Global Constraints

- `session.json` is written only by main, atomically, debounced 300 ms; renderer never touches the file.
- Undo history is restored only when `docHash(text about to be used) === snapshot.docHash`; otherwise dropped (spec table row "clean, 바뀜" and the dirty-store pairing case).
- `diff` tabs are not persisted; terminal tabs persist `cwd` only and are respawned.
- Restore happens before CLI startup paths are opened (so a path already restored is focused, not duplicated).
- `files.hotExit === false` → main asks "Quit without saving?" when the dirty store is non-empty; `true` (default) quits silently.
- Multi-cursor commands are pure `Command`s tested with `EditorState` only.
- TS strict, ts-belt, functional style. Conventional commits.

## File Structure

```
src/shared/session.ts                  # zod: WindowSnapshot, TabSnapshot, SessionFile
src/shared/hash.ts                     # fnv1a32(text) — renderer-side text hash
src/shared/channels.ts, ipc.ts         # (modify) session.save (send), session.load, app.bootstrap.session
src/main/session/sessionStore.ts       # load/merge/save/markClean, bounds
src/main/index.ts, ipc/handlers.ts, windows.ts   # (modify) open windows from session, cleanExit, hotExit prompt
src/renderer/src/app/sessionSync.ts    # snapshot builder + debounce + beforeunload
src/renderer/src/app/workspace.ts      # (modify) snapshot(), restore(snapshot), scrollTop capture
src/renderer/src/editor/commands.ts    # (modify) splitSelectionIntoLines, addCursorAbove/Below, skipOccurrence
src/renderer/src/keymap/defaults.ts    # (modify)
src/renderer/src/App.tsx, testHooks.ts # (modify)
tests/unit/shared/session.test.ts
tests/unit/shared/hash.test.ts
tests/unit/main/sessionStore.test.ts
tests/unit/renderer/multicursor.test.ts
tests/e2e/session.spec.ts
tests/e2e/multicursor.spec.ts
docs/superpowers/reports/m3a-session-multicursor.md
```

---

### Task 1: Session schema, text hash, main session store

**Files:**
- Create: `src/shared/session.ts`, `src/shared/hash.ts`, `src/main/session/sessionStore.ts`
- Modify: `src/shared/channels.ts`, `src/shared/ipc.ts`, `tests/unit/shared/ipc.test.ts`
- Test: `tests/unit/shared/session.test.ts`, `tests/unit/shared/hash.test.ts`, `tests/unit/main/sessionStore.test.ts`

**Interfaces:**
```ts
// shared/session.ts
BufferTabSnapshot = { kind: 'buffer'; path: string | null; dirtyId: string; format: { encoding; bom; eol }; hash: string | null; docHash: string; selection: { anchor; head }; scrollTop: number; history: unknown | null; languageId: string }
TerminalTabSnapshot = { kind: 'terminal'; cwd: string; title: string }
TabSnapshot = BufferTabSnapshot | TerminalTabSnapshot
PaneSnapshot = { kind: 'leaf'; tabs: TabSnapshot[]; active: number | null } | { kind: 'split'; direction: 'row' | 'col'; sizes: number[]; children: PaneSnapshot[] }
WindowSnapshot = { windowId: string; projectRoot: string | null; sidebar: { open: boolean; expanded: string[] }; layout: PaneSnapshot; activePath: number[] /* index path to the active leaf */ }
SessionFile = { version: 1; cleanExit: boolean; windows: { snapshot: WindowSnapshot; bounds: { x; y; width; height } | null }[] }
// shared/hash.ts
fnv1a32(text: string): string   // 8-hex-digit
// main/session/sessionStore.ts
createSessionStore(userData, { debounceMs = 300 }) → { load(): Promise<SessionFile | null>; update(windowId, snapshot, bounds): void; remove(windowId): void; markCleanExit(clean: boolean): Promise<void>; flush(): Promise<void> }
```
Channels: `session.save` (send) payload `WindowSnapshot`; `session.load` (invoke) → `SessionFile | null` (not needed by renderer in M3a but handy for tests); `Bootstrap` gains `session: WindowSnapshot | null`.

- [x] **Step 1: Write failing tests**

`tests/unit/shared/hash.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { fnv1a32 } from '@shared/hash'
describe('fnv1a32', () => {
  it('is stable, 8 hex digits, and sensitive to content', () => {
    expect(fnv1a32('')).toBe('811c9dc5')
    expect(fnv1a32('a')).toBe('e40c292c')
    expect(fnv1a32('한글')).toMatch(/^[0-9a-f]{8}$/)
    expect(fnv1a32('ab')).not.toBe(fnv1a32('ba'))
  })
})
```

`tests/unit/shared/session.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { SessionFile, WindowSnapshot } from '@shared/session'

const snapshot = {
  windowId: 'w1', projectRoot: '/p', sidebar: { open: true, expanded: ['/p/src'] },
  layout: { kind: 'split', direction: 'row', sizes: [0.5, 0.5], children: [
    { kind: 'leaf', active: 0, tabs: [{ kind: 'buffer', path: '/p/a.ts', dirtyId: 'w1:b1', format: { encoding: 'utf8', bom: false, eol: 'lf' }, hash: 'h', docHash: 'd', selection: { anchor: 1, head: 1 }, scrollTop: 0, history: null, languageId: 'typescript' }] },
    { kind: 'leaf', active: 0, tabs: [{ kind: 'terminal', cwd: '/p', title: 'Terminal 1' }] },
  ] },
  activePath: [1],
}

describe('session schemas', () => {
  it('accepts a nested snapshot and rejects unknown tab kinds', () => {
    expect(WindowSnapshot.safeParse(snapshot).success).toBe(true)
    expect(SessionFile.safeParse({ version: 1, cleanExit: false, windows: [{ snapshot, bounds: null }] }).success).toBe(true)
    const bad = { ...snapshot, layout: { kind: 'leaf', active: 0, tabs: [{ kind: 'diff' }] } }
    expect(WindowSnapshot.safeParse(bad).success).toBe(false)
  })
})
```

`tests/unit/main/sessionStore.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore } from '../../../src/main/session/sessionStore'
import type { WindowSnapshot } from '../../../src/shared/session'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'moru-session-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.useRealTimers() })

const snap = (windowId: string): WindowSnapshot => ({
  windowId, projectRoot: null, sidebar: { open: true, expanded: [] },
  layout: { kind: 'leaf', active: null, tabs: [] }, activePath: [],
})

describe('session store', () => {
  it('merges per-window snapshots and writes after the debounce', async () => {
    vi.useFakeTimers()
    const store = createSessionStore(dir, { debounceMs: 300 })
    store.update('w1', snap('w1'), { x: 0, y: 0, width: 800, height: 600 })
    store.update('w2', snap('w2'), null)
    await vi.advanceTimersByTimeAsync(350)
    const file = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8'))
    expect(file.windows.map((w: { snapshot: { windowId: string } }) => w.snapshot.windowId)).toEqual(['w1', 'w2'])
    expect(file.cleanExit).toBe(false)
  })

  it('remove drops a window and markCleanExit flushes with the flag', async () => {
    const store = createSessionStore(dir, { debounceMs: 0 })
    store.update('w1', snap('w1'), null)
    store.update('w2', snap('w2'), null)
    store.remove('w1')
    await store.markCleanExit(true)
    const loaded = await store.load()
    expect(loaded?.cleanExit).toBe(true)
    expect(loaded?.windows.map((w) => w.snapshot.windowId)).toEqual(['w2'])
  })

  it('load returns null for a missing or corrupt file and keeps a backup of the corrupt one', async () => {
    const store = createSessionStore(dir, { debounceMs: 0 })
    expect(await store.load()).toBeNull()
    await writeFile(join(dir, 'session.json'), '{ nope')
    expect(await store.load()).toBeNull()
    const files = (await import('node:fs/promises')).readdir(dir)
    expect((await files).some((f) => f.startsWith('session.corrupt.'))).toBe(true)
  })
})
```

- [x] **Step 2: Run to verify failure** → FAIL.

- [x] **Step 3: Implement**

`src/shared/hash.ts`:
```ts
export const fnv1a32 = (text: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
```

`src/shared/session.ts`:
```ts
import { z } from 'zod'
import { encodingNames, eolNames } from './encoding'

export const BufferTabSnapshot = z.object({
  kind: z.literal('buffer'),
  path: z.string().nullable(),
  dirtyId: z.string(),
  format: z.object({ encoding: z.enum(encodingNames), bom: z.boolean(), eol: z.enum(eolNames) }),
  hash: z.string().nullable(),
  docHash: z.string(),
  selection: z.object({ anchor: z.number().int().nonnegative(), head: z.number().int().nonnegative() }),
  scrollTop: z.number().nonnegative(),
  history: z.unknown().nullable(),
  languageId: z.string(),
})
export type BufferTabSnapshot = z.infer<typeof BufferTabSnapshot>

export const TerminalTabSnapshot = z.object({ kind: z.literal('terminal'), cwd: z.string(), title: z.string() })
export type TerminalTabSnapshot = z.infer<typeof TerminalTabSnapshot>

export const TabSnapshot = z.discriminatedUnion('kind', [BufferTabSnapshot, TerminalTabSnapshot])
export type TabSnapshot = z.infer<typeof TabSnapshot>

export type PaneSnapshot =
  | { kind: 'leaf'; tabs: TabSnapshot[]; active: number | null }
  | { kind: 'split'; direction: 'row' | 'col'; sizes: number[]; children: PaneSnapshot[] }

export const PaneSnapshot: z.ZodType<PaneSnapshot> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('leaf'), tabs: z.array(TabSnapshot), active: z.number().int().nonnegative().nullable() }),
    z.object({ kind: z.literal('split'), direction: z.enum(['row', 'col']), sizes: z.array(z.number()), children: z.array(PaneSnapshot) }),
  ]),
)

export const WindowSnapshot = z.object({
  windowId: z.string(),
  projectRoot: z.string().nullable(),
  sidebar: z.object({ open: z.boolean(), expanded: z.array(z.string()) }),
  layout: PaneSnapshot,
  activePath: z.array(z.number().int().nonnegative()),
})
export type WindowSnapshot = z.infer<typeof WindowSnapshot>

export const Bounds = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
export type Bounds = z.infer<typeof Bounds>

export const SessionFile = z.object({
  version: z.literal(1),
  cleanExit: z.boolean(),
  windows: z.array(z.object({ snapshot: WindowSnapshot, bounds: Bounds.nullable() })),
})
export type SessionFile = z.infer<typeof SessionFile>
```
(If zod 4 rejects `z.lazy` inside `discriminatedUnion`, use `z.union` for `PaneSnapshot`.)

`src/main/session/sessionStore.ts`:
```ts
import { readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { type Bounds, type SessionFile, SessionFile as SessionFileSchema, type WindowSnapshot } from '@shared/session'
import { writeAtomically } from '../fs/atomic'

type Entry = { readonly snapshot: WindowSnapshot; readonly bounds: Bounds | null }

export type SessionStore = {
  readonly load: () => Promise<SessionFile | null>
  readonly update: (windowId: string, snapshot: WindowSnapshot, bounds: Bounds | null) => void
  readonly remove: (windowId: string) => void
  readonly markCleanExit: (clean: boolean) => Promise<void>
  readonly flush: () => Promise<void>
}

const codeOf = (e: unknown): string | undefined => (e as { code?: string })?.code

export const createSessionStore = (userData: string, { debounceMs = 300 }: { debounceMs?: number } = {}): SessionStore => {
  const path = join(userData, 'session.json')
  let entries: Record<string, Entry> = {}
  let order: string[] = []
  let cleanExit = false
  let timer: NodeJS.Timeout | null = null

  const current = (): SessionFile => ({
    version: 1,
    cleanExit,
    windows: order.filter((id) => entries[id]).map((id) => entries[id] as Entry),
  })

  const write = async (): Promise<void> => {
    await writeAtomically(path, Buffer.from(JSON.stringify(current(), null, 2), 'utf8'))
  }

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void write(), debounceMs)
  }

  const load = async (): Promise<SessionFile | null> => {
    try {
      const parsed = SessionFileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
      if (parsed.success) return parsed.data
    } catch (e) {
      if (codeOf(e) === 'ENOENT') return null
    }
    await rename(path, join(userData, `session.corrupt.${Date.now()}.json`)).catch(() => undefined)
    return null
  }

  return {
    load,
    update: (windowId, snapshot, bounds) => {
      if (!entries[windowId]) order = [...order, windowId]
      entries = { ...entries, [windowId]: { snapshot, bounds } }
      schedule()
    },
    remove: (windowId) => {
      const { [windowId]: _dropped, ...rest } = entries
      entries = rest
      order = order.filter((id) => id !== windowId)
      schedule()
    },
    markCleanExit: async (clean) => {
      cleanExit = clean
      if (timer) clearTimeout(timer)
      await write()
    },
    flush: async () => {
      if (timer) clearTimeout(timer)
      await write()
    },
  }
}
```

Channels/contracts: `sessionSave: 'session.save'` in `sendChannels` with a shared `SessionSave = WindowSnapshot` payload validated by an `ipcMain.on` in handlers (`session.save` handler looks up the sender's window, reads `window.getBounds()`, calls `store.update`); `sessionLoad: 'session.load'` invoke → `SessionFile.nullable()`. `Bootstrap` gains `session: WindowSnapshot.nullable()`.

- [x] **Step 4: Run** — unit PASS, typecheck PASS.

- [x] **Step 5: Commit** — `feat(session): session schema, text hash, and debounced session store`

---

### Task 2: Renderer snapshot / restore and main window restore

**Files:**
- Create: `src/renderer/src/app/sessionSync.ts`
- Modify: `src/renderer/src/app/workspace.ts` (`snapshot()`, `restoreSession()`, scroll capture, `dirtyId` exposure, `openFileWithState`), `src/renderer/src/App.tsx`, `src/renderer/src/testHooks.ts`, `src/main/index.ts`, `src/main/ipc/handlers.ts`, `src/main/windows.ts`, `src/main/window.ts` (bounds option)
- Test: `tests/e2e/session.spec.ts`

**Interfaces:**
- Workspace: `snapshot(): WindowSnapshot` — walks `tree()`; buffer tabs: `history: doc.length <= 1_000_000 ? state.toJSON({ history: historyField }).history : null`, `docHash: fnv1a32(doc)`, `scrollTop` from `viewShowing(buffer)?.scrollDOM.scrollTop ?? stored`, `dirtyId` = the dirty-store id; terminal tabs: `{ cwd, title }`; `diff` tabs skipped; `activePath` = index path to the active leaf.
- Workspace: `restoreSession(snapshot: WindowSnapshot, dirtyEntries: DirtyEntry[]): Promise<void>` — rebuilds the tree leaf by leaf (uses `splitLeaf`/`createLeaf` helpers to reproduce the snapshot structure: easiest is a pure `treeFromSnapshot(snapshot.layout, nextPaneId)` that returns `{ tree, leafIds }`), then for each leaf restores tabs in order into that pane (set `activePane` temporarily), respawns terminals with saved cwd/title, sets active tab, sets sidebar/projectRoot, then focuses the active leaf.
- Buffer restore rule (spec table), given `snap` and optional `dirty` entry:
  1. path present: `fs.open` → if `Err io` → open an untitled-like buffer titled by path with `deleted` banner and text = `dirty?.text ?? ''` (skip if neither).
  2. text = `dirty?.text ?? file.text`; `useHistory = snap.history !== null && fnv1a32(text) === snap.docHash`.
  3. state = `EditorState.fromJSON({ doc: text, selection: clamp(snap.selection), history: useHistory ? snap.history : undefined }, { extensions: stateExtensions(languageId) }, useHistory ? { history: historyField } : {})`.
  4. buffer.saved = `{ ...file.format, doc: Text.of(file.text) }` (from disk) so dirty is computed against disk; if `file.hash !== snap.hash && dirty` → banner `external { diskHash: file.hash }`.
  5. untitled (path null): `newUntitled()` then set state as above with text from `dirty` (if no dirty entry, skip the tab).
  6. scrollTop applied in `requestAnimationFrame` after the view shows it.
- `sessionSync.ts`: `installSessionSync(ws, { send: (snapshot) => void, debounceMs = 500 })` — Solid `createEffect` over `ws.tree()`, `ws.state.tabs`, `ws.state.buffers` dirty/path, `ws.state.sidebar`, `ws.state.projectRoot`, `ws.state.activePane`, plus a periodic 5 s tick for scroll/selection; `beforeunload` → immediate send. Returns dispose.
- Main: on ready, `const session = await sessionStore.load()`; `restoreWindows = session?.windows ?? []`; open one window per entry with bounds and `session: snapshot`; if none, open one window; CLI paths/root attach to the first window (`startupPaths` merged). `handlers`: `app.bootstrap` includes `session` from window info; `session.save` handler; `window.on('closed')` → `sessionStore.remove(windowId)` **only when the app is not quitting** (track `quitting` flag set in `before-quit`), so quitting keeps all windows in the session. `before-quit`: `await sessionStore.markCleanExit(true)`; on ready `markCleanExit(false)` after load. hotExit false prompt: if `settings.files.hotExit === false` and `(await dirty.list()).length > 0` → `dialog.showMessageBoxSync({ buttons: ['Quit', 'Cancel'] })`; cancel → `event.preventDefault()`.
- Restore ordering in `App.tsx`: `restoreSession(boot.session, dirtyEntries)` replaces `restoreDirty()` when a session exists; otherwise fall back to `restoreDirty()`; then startup paths; then `installSessionSync`.
- Test hooks: `layout(): PaneSnapshot-like` (reuse `tabs()`), `scrollTop(): number`, `snapshotNow(): WindowSnapshot` (for assertions).

- [x] **Step 1: Write the failing E2E**

`tests/e2e/session.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('layout, tabs, selection, undo history and dirty text survive a graceful quit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-sess-'))
  const a = join(dir, 'a.ts')
  const b = join(dir, 'b.md')
  writeFileSync(a, 'const a = 1\n')
  writeFileSync(b, '# b\n')

  const first = await launchApp({ MORU_TEST_OPEN: a })
  await first.page.evaluate((p) => window.__moruTest!.openPath(p), b)
  await first.page.evaluate(() => window.__moruTest!.runCommand('view.splitRight'))
  await first.page.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await first.page.evaluate(() => window.__moruTest!.runCommand('view.focusPane', 1))
  await first.page.evaluate(() => window.__moruTest!.runCommand('tab.select', 1))
  await first.page.evaluate(() => window.__moruTest!.focus())
  await first.page.evaluate(() => window.__moruTest!.setCursor(0))
  await first.page.keyboard.type('// edited ')
  await first.page.evaluate(() => window.__moruTest!.setCursor(3))
  await first.page.waitForTimeout(1200)
  await first.app.close()

  const second = await launchApp({}, { userData: first.userData })
  const tabs = await second.page.evaluate(() => window.__moruTest!.tabs())
  expect(tabs.length).toBe(2)
  expect(tabs[0]?.tabs.map((t) => t.title)).toEqual(['a.ts', 'b.md'])
  expect(tabs[1]?.tabs.map((t) => t.title)).toEqual(['Terminal 1'])
  expect(tabs[0]?.active).toBe(true)

  await expect.poll(() => second.page.evaluate(() => window.__moruTest!.doc())).toBe('// edited const a = 1\n')
  expect(await second.page.evaluate(() => window.__moruTest!.dirty())).toBe(true)
  expect(await second.page.evaluate(() => window.__moruTest!.selections()[0]?.from)).toBe(3)

  await second.page.evaluate(() => window.__moruTest!.focus())
  await second.page.keyboard.press(`${mod}+z`)
  await expect.poll(() => second.page.evaluate(() => window.__moruTest!.doc())).toBe('const a = 1\n')
  expect(readFileSync(a, 'utf8')).toBe('const a = 1\n')
  await second.app.close()
})

test('a clean buffer whose file changed while closed loads the disk version without history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-sess-'))
  const a = join(dir, 'a.ts')
  writeFileSync(a, 'v1\n')
  const first = await launchApp({ MORU_TEST_OPEN: a })
  await first.page.evaluate(() => window.__moruTest!.focus())
  await first.page.keyboard.type('x')
  await first.page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await first.page.waitForTimeout(1200)
  await first.app.close()

  writeFileSync(a, 'changed outside\n')
  const second = await launchApp({}, { userData: first.userData })
  await expect.poll(() => second.page.evaluate(() => window.__moruTest!.doc())).toBe('changed outside\n')
  await second.page.evaluate(() => window.__moruTest!.focus())
  await second.page.keyboard.press(`${mod}+z`)
  await second.page.waitForTimeout(200)
  expect(await second.page.evaluate(() => window.__moruTest!.doc())).toBe('changed outside\n')
  await second.app.close()
})

test('two windows come back as two windows after SIGKILL', async () => {
  const first = await launchApp({})
  const w2 = first.app.waitForEvent('window')
  await first.page.evaluate(() => window.__moruTest!.runCommand('window.new'))
  const page2 = await w2
  await page2.waitForFunction(() => window.__moruTest?.ready() === true)
  await page2.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await first.page.waitForTimeout(1200)
  first.app.process().kill('SIGKILL')
  await new Promise((r) => setTimeout(r, 500))

  const second = await launchApp({}, { userData: first.userData })
  await expect.poll(() => second.app.windows().length).toBe(2)
  await second.app.close()
})
```

- [x] **Step 2: Run to verify failure** → FAIL.

- [x] **Step 3: Implement** — as in Interfaces. Key code sketches:

`treeFromSnapshot`:
```ts
const treeFromSnapshot = (snap: PaneSnapshot, nextId: () => string): { tree: PaneNode; leaves: { id: string; snap: Extract<PaneSnapshot, { kind: 'leaf' }> }[] } => {
  if (snap.kind === 'leaf') { const id = nextId(); return { tree: createLeaf(id), leaves: [{ id, snap }] } }
  const children = snap.children.map((c) => treeFromSnapshot(c, nextId))
  return {
    tree: { kind: 'split', id: `split:${nextId()}`, direction: snap.direction, children: children.map((c) => c.tree), sizes: normalize(snap.sizes) },
    leaves: children.flatMap((c) => c.leaves),
  }
}
```
(`normalize` exported from `paneTree.ts`.)

`snapshotOfTree(tree, tabs, buffers, views, terminals)` mirrors it for `snapshot()`.

State restore for a buffer with history:
```ts
const stateFromSnapshot = (text: string, languageId: string, snap: BufferTabSnapshot): EditorState => {
  const useHistory = snap.history !== null && fnv1a32(text) === snap.docHash
  const clamp = (n: number) => Math.min(n, text.length)
  const json = { doc: text, selection: { ranges: [{ anchor: clamp(snap.selection.anchor), head: clamp(snap.selection.head) }], main: 0 }, ...(useHistory ? { history: snap.history } : {}) }
  return EditorState.fromJSON(json, { extensions: extensionsFor(languageId) }, useHistory ? { history: historyField } : {})
}
```
`extensionsFor(languageId)` = the same extension list `stateFor` uses (factor it out of `stateFor`).

Main window restore in `index.ts`:
```ts
const session = await sessionStore.load()
const saved = session?.windows ?? []
if (saved.length === 0) openWindow(startupPaths(), startupRoot(), null, null)
else saved.forEach((w, i) => openWindow(i === 0 ? startupPaths() : [], i === 0 ? (startupRoot() ?? w.snapshot.projectRoot) : w.snapshot.projectRoot, w.snapshot, w.bounds))
await sessionStore.markCleanExit(false)
```
`openWindow(paths, root, snapshot, bounds)`; `createWindow(bounds?)` applies bounds when given.

- [x] **Step 4: Run** — `pnpm typecheck && pnpm test && pnpm build && pnpm exec playwright test tests/e2e/session.spec.ts tests/e2e/recovery.spec.ts tests/e2e/windows.spec.ts tests/e2e/tabs.spec.ts` → PASS. The existing `recovery.spec.ts` must still pass: with a session present, restore goes through `restoreSession` (which uses the dirty store for text).

- [x] **Step 5: Commit** — `feat(session): hot exit with layout, tabs, selection, scroll, undo history, and multi-window restore`

---

### Task 3: Multi-cursor commands

**Files:**
- Modify: `src/renderer/src/editor/commands.ts`, `src/renderer/src/keymap/defaults.ts`
- Test: `tests/unit/renderer/multicursor.test.ts`, `tests/e2e/multicursor.spec.ts`

**Interfaces:**
- `splitSelectionIntoLines: Command` — each non-empty range becomes one cursor per line it touches, placed at each line's end (or at the range end on the last line); empty ranges stay.
- `addCursorAbove` / `addCursorBelow: Command` — for every cursor add a new cursor on the previous/next line at the same column (clamped); keeps existing ranges.
- `skipOccurrence: Command` — removes the most recently added range (the main one) and selects the next occurrence after it (uses `selectNextOccurrence` after dropping).
- Bindings: `mod+shift+l` split, `ctrl+shift+arrowup/arrowdown` add cursor (mac) / `ctrl+alt+arrowup/arrowdown` (win), `mod+k mod+d` skip.

- [x] **Step 1: Write failing tests**

`tests/unit/renderer/multicursor.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { Command } from '@codemirror/view'
import { editorCommands } from '@renderer/editor/commands'

const cmd = (id: string): Command => editorCommands.find((c) => c.id === id)!.run
const run = (command: Command, state: EditorState): EditorState => {
  let next = state
  command({ state, dispatch: (tr) => { next = tr.state } } as never)
  return next
}
const ranges = (s: EditorState) => s.selection.ranges.map((r) => [r.anchor, r.head])

describe('splitSelectionIntoLines', () => {
  it('puts a cursor at the end of each selected line', () => {
    const state = EditorState.create({ doc: 'ab\ncd\nef\n', selection: { anchor: 0, head: 7 }, extensions: EditorState.allowMultipleSelections.of(true) })
    expect(ranges(run(cmd('editor.splitSelectionIntoLines'), state))).toEqual([[2, 2], [5, 5], [7, 7]])
  })
})

describe('addCursorAbove/Below', () => {
  it('adds cursors on neighbouring lines at the same column, clamped', () => {
    const state = EditorState.create({ doc: 'abcd\nab\nabcd\n', selection: { anchor: 3 }, extensions: EditorState.allowMultipleSelections.of(true) })
    const below = run(cmd('editor.addCursorBelow'), state)
    expect(ranges(below)).toEqual([[3, 3], [7, 7]])
    const below2 = run(cmd('editor.addCursorBelow'), below)
    expect(ranges(below2)).toEqual([[3, 3], [7, 7], [11, 11]])
    const above = run(cmd('editor.addCursorAbove'), EditorState.create({ doc: 'ab\nabcd\n', selection: { anchor: 6 }, extensions: EditorState.allowMultipleSelections.of(true) }))
    expect(ranges(above)).toEqual([[2, 2], [6, 6]])
  })
})

describe('skipOccurrence', () => {
  it('drops the last added occurrence and selects the next one', () => {
    const doc = 'foo bar foo baz foo\n'
    const state = EditorState.create({ doc, selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(8, 11)], 1), extensions: EditorState.allowMultipleSelections.of(true) })
    const next = run(cmd('editor.skipOccurrence'), state)
    expect(ranges(next)).toEqual([[0, 3], [16, 19]])
  })
})
```

`tests/e2e/multicursor.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { launchApp } from './launch'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const fixture = resolve('tests/e2e/fixtures/ime.ts')

test('split selection into lines then type at every cursor', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setSelection(0, 36))
  await page.keyboard.press(`${mod}+Shift+l`)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.selections().length)).toBe(2)
  await page.keyboard.type(' // x')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toContain('const greeting = ""; // x\nconst foo = 1; // x\n')
  await app.close()
})
```

- [x] **Step 2: Run to verify failure** → FAIL.

- [x] **Step 3: Implement**

Add to `src/renderer/src/editor/commands.ts`:
```ts
const splitSelectionIntoLines: Command = (view) => {
  const { state } = view
  const ranges = state.selection.ranges.flatMap((range) => {
    if (range.empty) return [range]
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    return Array.from({ length: last - first + 1 }, (_, i) => {
      const line = state.doc.line(first + i)
      return EditorSelection.cursor(Math.min(line.to, i === last - first ? range.to : line.to))
    })
  })
  view.dispatch({ selection: EditorSelection.create(ranges, ranges.length - 1) })
  return true
}

const addCursor = (delta: 1 | -1): Command => (view) => {
  const { state } = view
  const added = state.selection.ranges.flatMap((range) => {
    const line = state.doc.lineAt(range.head)
    const target = line.number + delta
    if (target < 1 || target > state.doc.lines) return []
    const next = state.doc.line(target)
    return [EditorSelection.cursor(Math.min(next.from + (range.head - line.from), next.to))]
  })
  if (added.length === 0) return false
  view.dispatch({ selection: EditorSelection.create([...state.selection.ranges, ...added], state.selection.ranges.length + added.length - 1) })
  return true
}

const skipOccurrence: Command = (view) => {
  const { state } = view
  if (state.selection.ranges.length < 2) return selectNextOccurrence(view)
  const main = state.selection.main
  const rest = state.selection.ranges.filter((r) => r !== main)
  view.dispatch({ selection: EditorSelection.create(rest, rest.length - 1) })
  return selectNextOccurrence(view)
}
```
Note `skipOccurrence` relies on `selectNextOccurrence` searching from the new main range (the last remaining) — the test expects `[0,3]` kept and `[16,19]` added when the dropped range was `[8,11]`; `selectNextOccurrence` searches after the main range's end wrapping around, so from `[0,3]` it finds `[8,11]` again. To skip properly, search **after the dropped range**: implement with `SearchCursor` from `@codemirror/search`: find the next occurrence of the main range's text starting at `main.to`, wrapping, that is not already selected; add it. Write it that way instead of calling `selectNextOccurrence`.

Register: `editor.splitSelectionIntoLines` (Split Selection into Lines), `editor.addCursorAbove`, `editor.addCursorBelow`, `editor.skipOccurrence` (Quick Skip Next). Defaults: common `editor('mod+shift+l', 'editor.splitSelectionIntoLines')`, `editor('mod+k mod+d', 'editor.skipOccurrence')`; mac `editor('ctrl+shift+arrowup', 'editor.addCursorAbove')`/down; win `editor('ctrl+alt+arrowup', ...)`/down.

- [x] **Step 4: Run** — unit + e2e PASS; `defaultBindings` conflict test still PASS (win `ctrl+shift+arrowup` is `moveLineUp` — hence `ctrl+alt` for add-cursor on win).

- [x] **Step 5: Commit** — `feat(editor): split selection into lines, add cursor above/below, skip occurrence`

---

### Task 4: Report

- [ ] `pnpm check`; write `docs/superpowers/reports/m3a-session-multicursor.md`; tick; commit `docs(m3a): add session and multi-cursor report`.

## Self-Review Notes

- §4.6 스키마 (T1) 저장 시점·복원 규칙 표 6행 (T2) hot exit 설정 (T2 main prompt) 다중 창 (T2). §5.2 자작 3종 (T3). SIGKILL 복원 E2E (T2 third test + existing recovery.spec).
- Types: `WindowSnapshot/PaneSnapshot/TabSnapshot` shared between renderer `snapshot()` and main store; `Bootstrap.session` nullable.
- Hooks: `snapshotNow`, `scrollTop`.
