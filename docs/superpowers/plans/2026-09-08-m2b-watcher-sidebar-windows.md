# M2b Watcher, External Changes, Sidebar, Multi-Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the editor safe next to an agent that edits files: detect external changes (silent diff-based reload for clean buffers, banner with compare/load/keep for dirty ones, deleted banner), add a project root with a sidebar file tree and basic file operations, and support several windows with per-window PTY ownership.

**Architecture:** `main/watch/service` subscribes with `@parcel/watcher` to the parent directory of every watched file (ref-counted), coalesces events per path (100 ms), drops events that match an "expected write" recorded by `fs.save`, and pushes `fs.changed` / `fs.deleted`. The renderer applies a clean-buffer change as one transaction computed with `@codemirror/merge`'s `diff` (annotated `external`, undoable, cursor mapped); a dirty buffer gets an `external` banner whose "Compare" opens a `diff` tab hosting a read-only `MergeView`. The sidebar reads directories lazily through `fs.tree`; `projectRoot` lives in the workspace and feeds terminal cwd. Each `BrowserWindow` gets a `windowId`; `pty.spawn` records the owning `WebContents` and pushes only to it.

**Tech Stack:** @parcel/watcher 2.6.0, @codemirror/merge 6.12.2, Electron `BrowserWindow`/`WebContents`, Solid.js.

**Spec:** `docs/superpowers/specs/2026-09-08-text-editor-design.md` — §4.4 ④ 예상 쓰기, §4.5 외부 변경, §4.7 `fs.watch/unwatch/tree/create/rename/delete`, §3.4 `ui/sidebar`, §3.5 pane 모델, §4.6 다중 창, §8 M2 수용 기준 (에이전트가 열린 파일을 수정해도 무손실).

## Global Constraints

- Own saves never trigger a reload: `fs.save` registers `{ path, hash, mtimeMs }` as an expected write before returning; the watcher drops the next event whose on-disk hash equals it (and expires entries after 10 s).
- Clean-buffer reload is a single undoable transaction built from `diff(oldText, newText)`; selection and scroll are mapped by the ChangeSet. Annotation `externalChange` marks it so the dirty tracker does not fire a dirty-store write for it (the buffer stays clean: `saved.doc` is updated to the new doc and `meta.hash` to the disk hash).
- Dirty-buffer external change never touches the doc; only the banner. "Keep Mine" sets `meta.hash = diskHash` so the next save overwrites without a conflict.
- Deleted file: buffer stays; banner; save recreates (expected write handles the `create` event).
- Sidebar operations go through main (`fs.create/rename/delete`); delete uses `shell.trashItem` (recoverable), never `rm`.
- Multi-window: pushes about a PTY go only to its owner; `fs.changed/deleted` go to all windows (each renderer ignores paths it does not have); `config.changed`/`keymap.changed` go to all.
- Terminal tabs keep working exactly as in M2a; existing E2E must stay green.

## File Structure

```
src/main/watch/expected.ts          # expected-write registry (pure, injectable clock)
src/main/watch/coalesce.ts          # per-path debounce (pure-ish, injectable timers)
src/main/watch/service.ts           # createWatchService({ push, subscribe: watcher.subscribe })
src/main/fs/tree.ts                 # listDirectory(dir) → entries sorted dirs-first
src/main/fs/ops.ts                  # createFile, renamePath, trashPath
src/main/windows.ts                 # createAppWindow(): { window, windowId }, registry, per-window push
src/main/ipc/register.ts            # (modify) handler receives { sender, windowId }
src/main/ipc/handlers.ts, index.ts, menu.ts, fs/write.ts   # (modify)
src/shared/channels.ts, ipc.ts      # (modify) fs.watch/unwatch/tree/create/rename/delete, fs.changed/fs.deleted, dialog.openFolder, window.new, app.bootstrap.windowId/projectRoot

src/renderer/src/editor/externalChange.ts   # externalChangeAnnotation, changeSetFromDiff(oldText, newText)
src/renderer/src/app/workspace.ts           # (modify) watch subscriptions, external flows, projectRoot, diff tabs
src/renderer/src/ui/diff/DiffHost.tsx       # MergeView host for `diff` tabs
src/renderer/src/ui/sidebar/Sidebar.tsx     # tree, context menu
src/renderer/src/ui/banner/Banner.tsx       # (modify) external / deleted kinds
src/renderer/src/App.tsx, testHooks.ts, style.css, registerCommands.ts, keymap/defaults.ts  # (modify)

tests/unit/main/expected.test.ts
tests/unit/main/coalesce.test.ts
tests/unit/main/tree.test.ts
tests/unit/renderer/externalChange.test.ts
tests/e2e/external.spec.ts
tests/e2e/sidebar.spec.ts
tests/e2e/windows.spec.ts
docs/superpowers/reports/m2b-watcher-sidebar-windows.md
```

---

### Task 1: Watch service in main (expected writes, coalescing, subscriptions, push)

**Files:**
- Create: `src/main/watch/expected.ts`, `src/main/watch/coalesce.ts`, `src/main/watch/service.ts`
- Modify: `src/main/fs/write.ts` (register expected write via an injected callback), `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/main/ipc/handlers.ts`, `src/main/index.ts`, `tests/unit/shared/ipc.test.ts`
- Test: `tests/unit/main/expected.test.ts`, `tests/unit/main/coalesce.test.ts`

**Interfaces:**
- `createExpectedWrites(now = Date.now, ttlMs = 10_000)` → `{ record(path, hash): void; consume(path, hash): boolean }` — `consume` returns true (and removes the entry) when an unexpired record with the same hash exists.
- `createCoalescer(delayMs, onFlush: (path: string) => void, timers = { set: setTimeout, clear: clearTimeout })` → `{ touch(path): void; dispose(): void }`.
- `createWatchService(deps: { subscribe: typeof watcher.subscribe; push: (channel, payload) => void; readHash: (path) => Promise<string | null>; expected: ExpectedWrites })` → `{ watch(path): Promise<void>; unwatch(path): Promise<void>; dispose(): Promise<void> }` — subscribes per parent directory with ref counts; on event for a watched path: `delete` (and file missing) → push `fs.deleted`; otherwise read hash; if `expected.consume(path, hash)` → drop; else push `fs.changed { path, hash, mtimeMs }`.
- `writeTextFile` gains an optional `onWritten?: (path, hash) => void` argument (called before returning `Ok`).
- Contracts: `fs.watch` `{ path }` → `true`; `fs.unwatch` `{ path }` → `true`; push `fs.changed` `{ path, hash, mtimeMs }`, `fs.deleted` `{ path }`.

- [x] **Step 1: Write failing tests**

`tests/unit/main/expected.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createExpectedWrites } from '../../../src/main/watch/expected'

describe('expected writes', () => {
  it('consumes a matching record once', () => {
    let now = 1000
    const ew = createExpectedWrites(() => now, 10_000)
    ew.record('/a', 'h1')
    expect(ew.consume('/a', 'h1')).toBe(true)
    expect(ew.consume('/a', 'h1')).toBe(false)
  })

  it('ignores different hashes and expired records', () => {
    let now = 1000
    const ew = createExpectedWrites(() => now, 10_000)
    ew.record('/a', 'h1')
    expect(ew.consume('/a', 'other')).toBe(false)
    now = 12_000
    expect(ew.consume('/a', 'h1')).toBe(false)
  })
})
```

`tests/unit/main/coalesce.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createCoalescer } from '../../../src/main/watch/coalesce'

describe('coalescer', () => {
  it('flushes each path once after the quiet period', async () => {
    vi.useFakeTimers()
    const flushed: string[] = []
    const c = createCoalescer(100, (p) => flushed.push(p))
    c.touch('/a')
    c.touch('/b')
    await vi.advanceTimersByTimeAsync(60)
    c.touch('/a')
    await vi.advanceTimersByTimeAsync(60)
    expect(flushed).toEqual(['/b'])
    await vi.advanceTimersByTimeAsync(60)
    expect(flushed).toEqual(['/b', '/a'])
    c.dispose()
    vi.useRealTimers()
  })
})
```

Add to `tests/unit/shared/ipc.test.ts`:
```ts
  it('watch contracts', () => {
    expect(contracts['fs.watch'].request.safeParse({ path: '/a' }).success).toBe(true)
    expect(pushContracts['fs.changed'].safeParse({ path: '/a', hash: 'h', mtimeMs: 1 }).success).toBe(true)
    expect(pushContracts['fs.deleted'].safeParse({ path: '/a' }).success).toBe(true)
  })
```

- [x] **Step 2: Run to verify failure** → FAIL.

- [x] **Step 3: Implement**

`src/main/watch/expected.ts`:
```ts
export type ExpectedWrites = {
  readonly record: (path: string, hash: string) => void
  readonly consume: (path: string, hash: string) => boolean
}

type Entry = { readonly hash: string; readonly at: number }

export const createExpectedWrites = (now: () => number = Date.now, ttlMs = 10_000): ExpectedWrites => {
  let entries: Record<string, Entry> = {}

  return {
    record: (path, hash) => {
      entries = { ...entries, [path]: { hash, at: now() } }
    },
    consume: (path, hash) => {
      const entry = entries[path]
      if (!entry) return false
      const { [path]: _dropped, ...rest } = entries
      entries = rest
      return entry.hash === hash && now() - entry.at <= ttlMs
    },
  }
}
```

`src/main/watch/coalesce.ts`:
```ts
export type Coalescer = { readonly touch: (path: string) => void; readonly dispose: () => void }

export const createCoalescer = (delayMs: number, onFlush: (path: string) => void): Coalescer => {
  let timers: Record<string, ReturnType<typeof setTimeout>> = {}

  return {
    touch: (path) => {
      const existing = timers[path]
      if (existing) clearTimeout(existing)
      timers = {
        ...timers,
        [path]: setTimeout(() => {
          const { [path]: _dropped, ...rest } = timers
          timers = rest
          onFlush(path)
        }, delayMs),
      }
    },
    dispose: () => {
      Object.values(timers).forEach(clearTimeout)
      timers = {}
    },
  }
}
```

`src/main/watch/service.ts`:
```ts
import { readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AsyncSubscription, Event, Options } from '@parcel/watcher'
import type { PushChannel, PushPayload } from '@shared/ipc'
import { hashBytes } from '../fs/hash'
import { createCoalescer } from './coalesce'
import type { ExpectedWrites } from './expected'

type Subscribe = (dir: string, cb: (err: Error | null, events: Event[]) => void, opts?: Options) => Promise<AsyncSubscription>
type Push = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

type Deps = { readonly subscribe: Subscribe; readonly push: Push; readonly expected: ExpectedWrites; readonly delayMs?: number }

type DirEntry = { readonly subscription: AsyncSubscription; readonly count: number }

export type WatchService = {
  readonly watch: (path: string) => Promise<void>
  readonly unwatch: (path: string) => Promise<void>
  readonly dispose: () => Promise<void>
}

const codeOf = (e: unknown): string | undefined => (e as { code?: string })?.code

export const createWatchService = ({ subscribe, push, expected, delayMs = 100 }: Deps): WatchService => {
  let watched: Record<string, true> = {}
  let dirs: Record<string, DirEntry> = {}

  const settle = async (path: string): Promise<void> => {
    if (!watched[path]) return
    try {
      const [bytes, info] = await Promise.all([readFile(path), stat(path)])
      const hash = hashBytes(bytes)
      if (expected.consume(path, hash)) return
      push('fs.changed', { path, hash, mtimeMs: info.mtimeMs })
    } catch (e) {
      if (codeOf(e) === 'ENOENT') push('fs.deleted', { path })
    }
  }

  const coalescer = createCoalescer(delayMs, (path) => void settle(path))

  const onEvents = (err: Error | null, events: Event[]): void => {
    if (err) return
    events.filter((event) => watched[event.path]).forEach((event) => coalescer.touch(event.path))
  }

  const watch = async (path: string): Promise<void> => {
    if (watched[path]) return
    watched = { ...watched, [path]: true }

    const dir = dirname(path)
    const existing = dirs[dir]
    if (existing) {
      dirs = { ...dirs, [dir]: { ...existing, count: existing.count + 1 } }
      return
    }
    const subscription = await subscribe(dir, onEvents, { ignore: ['**/node_modules/**', '**/.git/**'] })
    dirs = { ...dirs, [dir]: { subscription, count: 1 } }
  }

  const unwatch = async (path: string): Promise<void> => {
    if (!watched[path]) return
    const { [path]: _dropped, ...restWatched } = watched
    watched = restWatched

    const dir = dirname(path)
    const entry = dirs[dir]
    if (!entry) return
    if (entry.count > 1) {
      dirs = { ...dirs, [dir]: { ...entry, count: entry.count - 1 } }
      return
    }
    const { [dir]: _gone, ...restDirs } = dirs
    dirs = restDirs
    await entry.subscription.unsubscribe()
  }

  return {
    watch,
    unwatch,
    dispose: async () => {
      coalescer.dispose()
      await Promise.all(Object.values(dirs).map((d) => d.subscription.unsubscribe()))
      dirs = {}
      watched = {}
    },
  }
}
```

`fs/write.ts`: `writeTextFile(request, onWritten?: (path: string, hash: string) => void)`; after `writeAtomically`: `onWritten?.(request.path, hashBytes(encoded.bytes))`.

Channels: `fsWatch: 'fs.watch'`, `fsUnwatch: 'fs.unwatch'`, push `fsChanged: 'fs.changed'`, `fsDeleted: 'fs.deleted'`. Contracts as above. Handlers: `HandlerDeps.watch: WatchService`, `HandlerDeps.expected: ExpectedWrites`; `handle('fs.save', (req) => writeTextFile(req, (p, h) => expected.record(p, h)))`; `fs.watch/unwatch` → `ok(true)`. `index.ts`: `const expected = createExpectedWrites(); const watch = createWatchService({ subscribe: watcher.subscribe, push: pushToAll, expected })` (`import watcher from '@parcel/watcher'`), `app.on('before-quit', () => void watch.dispose())`.

- [x] **Step 4: Run** — `pnpm vitest run tests/unit && pnpm typecheck && pnpm build && pnpm exec playwright test tests/e2e/smoke.spec.ts` → PASS.

- [x] **Step 5: Commit** — `feat(watch): file watch service with expected-write suppression and coalescing`

---

### Task 2: External change flows in the renderer (silent diff reload, banners, compare tab)

**Files:**
- Create: `src/renderer/src/editor/externalChange.ts`, `src/renderer/src/ui/diff/DiffHost.tsx`
- Modify: `src/renderer/src/app/workspace.ts`, `src/renderer/src/ui/banner/Banner.tsx`, `src/renderer/src/ui/layout/PaneView.tsx`, `src/renderer/src/ui/tabs/TabStrip.tsx`, `src/renderer/src/testHooks.ts`, `src/renderer/src/style.css`
- Test: `tests/unit/renderer/externalChange.test.ts`, `tests/e2e/external.spec.ts`

**Interfaces:**
- `externalChangeAnnotation: AnnotationType<boolean>`; `changeSetFromDiff(oldText: string, newText: string): ChangeSpec[]` — maps `@codemirror/merge` `Change[]` (`fromA,toA,fromB,toB`) to `{ from: fromA, to: toA, insert: newText.slice(fromB, toB) }`.
- Workspace: on open → `invoke('fs.watch')`; on drop → `fs.unwatch`; subscriptions `on('fs.changed')`, `on('fs.deleted')`. `applyExternalChange(bufferId, file: OpenedFile)`: if clean → dispatch diff transaction with `annotations: externalChangeAnnotation.of(true)`, then `putBuffer(markSaved(updated, meta))` (buffer stays clean, hash updated); if dirty → banner `{ kind: 'external', diskHash }`. `fs.deleted` → banner `{ kind: 'deleted' }` (only if buffer has a path).
- Banner actions: external → `Load Disk Version` (re-open, replace contents, clear), `Compare` (open `diff` tab), `Keep Mine` (`meta.hash = diskHash`, clear); deleted → `Save` (re-create), `Dismiss`.
- Tab kind `diff`: `{ id; kind: 'diff'; bufferId; diskText: string; title }`. `DiffHost` renders `new MergeView({ a: { doc: diskText, extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false)] }, b: { doc: buffer doc, extensions: [...] }, parent, highlightChanges: true, gutter: true })`; disposed on cleanup.
- `putBuffer` skips the dirty-sync call when the buffer became clean because of an external change (already covered: after `markSaved`, `next.dirty` is false → `changed(..., false)` clears — fine).
- Test hooks: `bannerKind(): string | null`.

- [x] **Step 1: Write failing tests**

`tests/unit/renderer/externalChange.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { changeSetFromDiff } from '@renderer/editor/externalChange'

describe('changeSetFromDiff', () => {
  it('produces changes that transform old into new and keep unrelated cursor positions', () => {
    const oldText = 'const a = 1\nconst b = 2\nconst c = 3\n'
    const newText = 'const a = 1\nconst b = 22\nconst c = 3\nconst d = 4\n'
    const state = EditorState.create({ doc: oldText, selection: { anchor: 5 } })
    const tr = state.update({ changes: changeSetFromDiff(oldText, newText) })
    expect(tr.state.doc.toString()).toBe(newText)
    expect(tr.state.selection.main.head).toBe(5)
  })

  it('returns no changes for identical text', () => {
    expect(changeSetFromDiff('same', 'same')).toEqual([])
  })
})
```

`tests/e2e/external.spec.ts`:
```ts
import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const tempFile = (name: string, text: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-ext-'))
  const path = join(dir, name)
  writeFileSync(path, text)
  return path
}
const doc = (page: Page) => page.evaluate(() => window.__moruTest!.doc())

test('a clean buffer silently reloads an external edit, keeps the cursor, and stays undoable', async () => {
  const path = tempFile('a.ts', 'const a = 1\nconst b = 2\nconst c = 3\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(30))

  writeFileSync(path, 'const a = 1\nconst b = 22\nconst c = 3\nconst d = 4\n')
  await expect.poll(() => doc(page), { timeout: 10_000 }).toBe('const a = 1\nconst b = 22\nconst c = 3\nconst d = 4\n')
  expect(await page.evaluate(() => window.__moruTest!.selections()[0]?.from)).toBe(31)
  expect(await page.evaluate(() => window.__moruTest!.dirty())).toBe(false)
  await expect(page.getByTestId('banner')).toHaveCount(0)

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect.poll(() => doc(page)).toBe('const a = 1\nconst b = 2\nconst c = 3\n')
  expect(await page.evaluate(() => window.__moruTest!.dirty())).toBe(true)
  await app.close()
})

test('a dirty buffer gets a banner: compare, load disk version, keep mine', async () => {
  const path = tempFile('b.txt', 'v1\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('mine ')

  writeFileSync(path, 'v2 from agent\n')
  await expect(page.getByTestId('banner')).toContainText('changed on disk', { timeout: 10_000 })
  expect(await doc(page)).toBe('mine v1\n')

  await page.getByTestId('banner-action').filter({ hasText: 'Compare' }).click()
  await expect(page.locator('.cm-merge-a')).toHaveCount(1)
  await page.evaluate(() => window.__moruTest!.runCommand('tab.close'))

  await page.evaluate(() => window.__moruTest!.runCommand('tab.select', 1))
  await page.getByTestId('banner-action').filter({ hasText: 'Keep Mine' }).click()
  await expect(page.getByTestId('banner')).toHaveCount(0)
  await page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await expect.poll(() => readFileSync(path, 'utf8')).toBe('mine v1\n')

  writeFileSync(path, 'v3\n')
  await expect.poll(() => doc(page), { timeout: 10_000 }).toBe('v3\n')
  await app.close()
})

test('a deleted file shows a banner and save recreates it', async () => {
  const path = tempFile('c.txt', 'keep me\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  unlinkSync(path)
  await expect(page.getByTestId('banner')).toContainText('deleted', { timeout: 10_000 })

  await page.getByTestId('banner-action').filter({ hasText: 'Save' }).click()
  await expect(page.getByTestId('banner')).toHaveCount(0)
  expect(readFileSync(path, 'utf8')).toBe('keep me\n')
  await app.close()
})

test('own saves do not trigger a reload or banner', async () => {
  const path = tempFile('d.txt', 'x\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('y')
  await page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await page.waitForTimeout(800)
  await expect(page.getByTestId('banner')).toHaveCount(0)
  expect(await doc(page)).toBe('yx\n')
  await app.close()
})
```

- [x] **Step 2: Run to verify failure** → FAIL.

- [x] **Step 3: Implement**

`src/renderer/src/editor/externalChange.ts`:
```ts
import { diff } from '@codemirror/merge'
import { Annotation, type ChangeSpec } from '@codemirror/state'

export const externalChangeAnnotation = Annotation.define<boolean>()

export const changeSetFromDiff = (oldText: string, newText: string): ChangeSpec[] =>
  diff(oldText, newText).map((change) => ({
    from: change.fromA,
    to: change.toA,
    insert: newText.slice(change.fromB, change.toB),
  }))
```

Workspace additions:
- `Banner` union gains `{ kind: 'external'; diskHash: string }` and `{ kind: 'deleted' }`.
- `Tab` union gains `{ id; kind: 'diff'; bufferId: BufferId; diskText: string; title: string }`.
- After a successful `fs.open` in `openFile` → `void invoke('fs.watch', { path })`; in `dropTab` for buffer tabs with a path → `void invoke('fs.unwatch', { path })` (only when no other tab shows the same path — tabs are unique per path so always).
- Subscriptions in the constructor:
  ```ts
  on('fs.changed', ({ path }) => void handleExternalChange(path))
  on('fs.deleted', ({ path }) => { const b = bufferByPath(path); if (b) setState('banners', b.id, { kind: 'deleted' }) })
  ```
  `handleExternalChange(path)`: `const buffer = bufferByPath(path)`; if none return; `const result = await invoke('fs.open', { path })`; on Ok `file`: if `isDirty(buffer)` → banner external `{ diskHash: file.hash }`; else `applySilentReload(buffer, file)`.
  `applySilentReload(buffer, file)`: `const spec = { changes: changeSetFromDiff(buffer.state.doc.toString(), file.text), annotations: externalChangeAnnotation.of(true) }`; `const view = viewShowing(buffer.id)`; `const nextState = view ? (view.dispatch(spec), view.state) : buffer.state.update(spec).state`; `putBuffer(markSaved({ ...buffer, state: nextState }, stripText(file)))` — export `stripText` from buffers.ts as `metaOf(file)`; `clearBanner(buffer.id)`.
  Note: when the view dispatches, `onUpdate` runs `putBuffer` with the not-yet-saved buffer (dirty momentarily) → dirty-sync would write; the immediate `putBuffer(markSaved(...))` flips it back → `changed(..., false)` clears. Acceptable; to avoid the churn, check `update.transactions.some(t => t.annotation(externalChangeAnnotation))` in `onUpdate` and skip `putBuffer` there (the reload path puts the final buffer itself). Implement that skip in `baseExtensions` hooks: `onUpdate(state, view, external: boolean)`.
- Actions: `loadDiskVersion()` = `reload()` (exists), `keepMine()`: `updateActive((b) => b.meta ? { ...b, meta: { ...b.meta, hash: banner.diskHash } } : b)` + clear; `compareWithDisk()`: `invoke('fs.open', { path })` → add tab `{ kind: 'diff', bufferId, diskText: file.text, title: \`${titleOf(buffer)} ↔ disk\` }`; `recreateDeleted()` = `save('overwrite')` (expectedHash null since file missing → `conflictOf` returns null anyway).
- `DiffHost.tsx`:
  ```tsx
  import { MergeView } from '@codemirror/merge'
  import { EditorState } from '@codemirror/state'
  import { EditorView } from '@codemirror/view'
  import { onCleanup, onMount } from 'solid-js'
  export const DiffHost = (props: { diskText: string; bufferText: string; theme: Extension }) => {
    let host!: HTMLDivElement
    onMount(() => {
      const readOnly = [EditorState.readOnly.of(true), EditorView.editable.of(false), props.theme]
      const view = new MergeView({ a: { doc: props.diskText, extensions: readOnly }, b: { doc: props.bufferText, extensions: readOnly }, parent: host, highlightChanges: true, gutter: true })
      onCleanup(() => view.destroy())
    })
    return <div class="diff-host" ref={host} />
  }
  ```
  `PaneView` renders `<DiffHost>` for `diff` tabs (hide editor wrap like terminals); `TabStrip` title from `tab.title`; `testHooks.tabs()` title likewise. `bufferText` = current doc of the referenced buffer at open time.
- `Banner.tsx`: add texts `'File changed on disk while you have unsaved edits.'` (external) and `'File was deleted on disk.'` (deleted) and the actions above.

Style: `.diff-host { flex: 1 1 auto; min-height: 0; overflow: auto } .diff-host .cm-mergeView { height: 100% } .diff-host .cm-editor { height: 100% }`.

- [x] **Step 4: Run** — `pnpm typecheck && pnpm test && pnpm build && pnpm exec playwright test tests/e2e/external.spec.ts tests/e2e/roundtrip.spec.ts tests/e2e/banner.spec.ts tests/e2e/recovery.spec.ts` → PASS. Watch out: the recovery test restores a dirty buffer then re-opens — `fs.watch` on a temp dir must not fire on the initial open (no write happens) — fine.

- [x] **Step 5: Commit** — `feat(external): diff-based silent reload, dirty/deleted banners, compare tab`

---

### Task 3: Project root, sidebar tree, file operations

**Files:**
- Create: `src/main/fs/tree.ts`, `src/main/fs/ops.ts`, `src/renderer/src/ui/sidebar/Sidebar.tsx`
- Modify: `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/main/ipc/handlers.ts`, `src/main/index.ts` (argv directory → projectRoot), `src/main/menu.ts`, `src/renderer/src/app/workspace.ts`, `src/renderer/src/app/registerCommands.ts`, `src/renderer/src/keymap/defaults.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/testHooks.ts`, `src/renderer/src/style.css`
- Test: `tests/unit/main/tree.test.ts`, `tests/e2e/sidebar.spec.ts`

**Interfaces:**
- `listDirectory(dir): Promise<IpcResult<TreeEntry[], IoError>>`, `TreeEntry = { name: string; path: string; kind: 'file' | 'dir' }` — directories first, then files, both case-insensitive by name; hidden entries included except `.git`, `node_modules`, `.DS_Store`.
- `createFile(path)` (fails if exists), `renamePath(from, to)` (fails if target exists), `trashPath(path)` (`shell.trashItem`).
- Contracts: `fs.tree { dir }` → `TreeEntry[]`; `fs.create { path }` / `fs.rename { from, to }` / `fs.delete { path }` → `true`; `dialog.openFolder` → `{ path: string | null }`. `Bootstrap` gains `projectRoot: string | null` (from `MORU_TEST_ROOT` or a directory in argv) and `windowId: string` (Task 4 fills; set `'main'` here).
- Workspace: `projectRoot: string | null` in state; `setProjectRoot(path)`; terminal cwd prefers `projectRoot`; `relativePath` prefers it too. Sidebar state: `sidebarOpen: boolean`, `expanded: Record<string, true>`, `entries: Record<dir, TreeEntry[]>`; actions `toggleSidebar`, `expandDir(dir)`, `collapseDir(dir)`, `refreshDir(dir)`, `createFileIn(dir, name)`, `renameEntry(path, newName)`, `deleteEntry(path)` (refreshes parent; a buffer open for a renamed path gets `meta.path` updated; deleted → tab stays with `deleted` banner).
- Commands: `sidebar.toggle` (`mod+k mod+b`), `project.openFolder`, `sidebar.newFile` / `sidebar.rename` / `sidebar.delete` (args `{ dir | path, name }`), `sidebar.refresh`.
- Sidebar UI: `[data-testid="sidebar"]`, rows `[data-testid="tree-row"]` with `data-path`, click file → open, click dir → toggle; right-click row → `Popup` with New File / Rename / Delete (names via `window.prompt` in normal mode; in test mode use `MORU_TEST_PROMPT` via a tiny `dialog.prompt` contract? Simpler: commands take args and the E2E calls them via `runCommand`; the context menu uses `window.prompt`).

- [x] **Step 1: Write failing tests**

`tests/unit/main/tree.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listDirectory } from '../../../src/main/fs/tree'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'moru-tree-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('listDirectory', () => {
  it('lists directories first, sorted case-insensitively, skipping .git and node_modules', async () => {
    await mkdir(join(dir, 'src'))
    await mkdir(join(dir, '.git'))
    await mkdir(join(dir, 'node_modules'))
    await mkdir(join(dir, 'Docs'))
    await writeFile(join(dir, 'b.ts'), '')
    await writeFile(join(dir, 'A.md'), '')
    await writeFile(join(dir, '.env'), '')

    const result = await listDirectory(dir)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.map((e) => [e.name, e.kind])).toEqual([
      ['Docs', 'dir'], ['src', 'dir'], ['.env', 'file'], ['A.md', 'file'], ['b.ts', 'file'],
    ])
  })

  it('returns io error for a missing directory', async () => {
    const result = await listDirectory(join(dir, 'nope'))
    expect(result.ok).toBe(false)
  })
})
```

`tests/e2e/sidebar.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'moru-proj-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1\n')
  writeFileSync(join(root, 'README.md'), '# hi\n')
  return root
}

test('sidebar lists the project root, expands directories, opens files', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root })
  await expect(page.getByTestId('sidebar')).toBeVisible()
  await expect(page.getByTestId('tree-row')).toHaveText(['src', 'README.md'])

  await page.getByTestId('tree-row').filter({ hasText: 'src' }).click()
  await expect(page.getByTestId('tree-row')).toHaveText(['src', 'index.ts', 'README.md'])

  await page.getByTestId('tree-row').filter({ hasText: 'index.ts' }).click()
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('export const x = 1\n')
  await expect(page.getByTestId('path')).toHaveText(join(root, 'src', 'index.ts'))

  await page.evaluate(() => window.__moruTest!.runCommand('sidebar.toggle'))
  await expect(page.getByTestId('sidebar')).toBeHidden()
  await app.close()
})

test('new file, rename and delete refresh the tree and keep buffers consistent', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root })

  await page.evaluate((r) => window.__moruTest!.runCommand('sidebar.newFile', { dir: r, name: 'notes.md' }), root)
  await expect(page.getByTestId('tree-row').filter({ hasText: 'notes.md' })).toHaveCount(1)
  expect(existsSync(join(root, 'notes.md'))).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'notes.md'))

  await page.evaluate((r) => window.__moruTest!.runCommand('sidebar.rename', { path: `${r}/notes.md`, name: 'todo.md' }), root)
  await expect(page.getByTestId('tree-row').filter({ hasText: 'todo.md' })).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'todo.md'))

  await page.evaluate((r) => window.__moruTest!.runCommand('sidebar.delete', { path: `${r}/README.md` }), root)
  await expect(page.getByTestId('tree-row').filter({ hasText: 'README.md' })).toHaveCount(0)
  expect(existsSync(join(root, 'README.md'))).toBe(false)
  await app.close()
})

test('terminal cwd is the project root', async () => {
  test.skip(process.platform === 'win32', 'pwd is POSIX')
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root })
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await page.evaluate(() => window.__moruTest!.terminalFocus())
  await page.keyboard.type('pwd\n')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.terminalText()), { timeout: 10_000 }).toContain(root.replace('/private', ''))
  await app.close()
})
```

`readFileSync` import unused → drop it from the spec.

- [x] **Step 2: Run to verify failure** → FAIL.

- [x] **Step 3: Implement**

`src/main/fs/tree.ts`:
```ts
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { A, pipe } from '@mobily/ts-belt'
import type { TreeEntry } from '@shared/ipc'
import { type IpcResult, ok, err } from '@shared/result'

const skipped = ['.git', 'node_modules', '.DS_Store']

const byName = (a: TreeEntry, b: TreeEntry): number => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

export const listDirectory = async (dir: string): Promise<IpcResult<TreeEntry[], { kind: 'io'; message: string }>> => {
  try {
    const dirents = await readdir(dir, { withFileTypes: true })
    const entries = pipe(
      dirents,
      A.filter((d) => !skipped.includes(d.name)),
      A.map((d): TreeEntry => ({ name: d.name, path: join(dir, d.name), kind: d.isDirectory() ? 'dir' : 'file' })),
    )
    const dirs = [...entries.filter((e) => e.kind === 'dir')].sort(byName)
    const files = [...entries.filter((e) => e.kind === 'file')].sort(byName)
    return ok([...dirs, ...files])
  } catch (e) {
    return err({ kind: 'io', message: e instanceof Error ? e.message : String(e) })
  }
}
```

`src/main/fs/ops.ts`: `createFile(path)` → `writeFile(path, '', { flag: 'wx' })`; `renamePath(from, to)` → `access(to)` must fail, then `rename`; `trashPath(path)` → `shell.trashItem(path)`; each returns `IpcResult<true, IoError>`.

Contracts (`ipc.ts`): `TreeEntry = z.object({ name, path, kind: z.enum(['file','dir']) })`; `fs.tree`, `fs.create`, `fs.rename`, `fs.delete`, `dialog.openFolder` (response `{ path: string | null }`); `Bootstrap` adds `projectRoot: z.string().nullable()`, `windowId: z.string()`.

Main: `startupPaths()` splits argv into files and directories: the first directory becomes `projectRoot`; `MORU_TEST_ROOT` overrides. Menu: File → `Open Folder…` (`project.openFolder`), View → `Toggle Sidebar` (`sidebar.toggle`). Handlers: `dialog.openFolder` via `showOpenDialog({ properties: ['openDirectory'] })`.

Workspace: state `projectRoot`, `sidebarOpen: true`, `expanded`, `entries`; `setProjectRoot(root)` clears `entries`/`expanded` and loads the root. `expandDir(dir)`: `invoke('fs.tree', { dir })` → `setState('entries', dir, entries)` + `expanded[dir] = true`. Sidebar ops as described; after each op `refreshDir(parent)`. `renameEntry` updates any buffer whose `meta.path` starts with the old path (file or directory prefix). Terminal cwd: `state.projectRoot ?? dirnameOf(activePath) ?? null`. `relativePath`: prefer `projectRoot`.

`Sidebar.tsx`: recursive `Rows(dir, depth)`; row shows chevron for dirs; indent `depth * 12px`; right-click → `Popup` (New File / Rename / Delete) anchored at the row; New/Rename use `window.prompt`.

Layout: `.app` becomes a row: `<Sidebar>` (width 240px, `hidden` when closed) + `.main-column` (workspace + statusbar). Adjust `style.css` accordingly.

Test hooks: `sidebarRows(): { name; path; kind; depth }[]`, `projectRoot(): string | null`.

- [x] **Step 4: Run** — full check → PASS.

- [x] **Step 5: Commit** — `feat(sidebar): project root with lazy file tree, new/rename/delete, terminal cwd`

---

### Task 4: Multiple windows with per-window PTY ownership

**Files:**
- Create: `src/main/windows.ts`
- Modify: `src/main/index.ts`, `src/main/window.ts`, `src/main/ipc/register.ts` (pass `sender`), `src/main/ipc/handlers.ts`, `src/main/pty/manager.ts` (owner per pty), `src/main/menu.ts`, `src/shared/ipc.ts`, `src/renderer/src/app/registerCommands.ts`, `src/renderer/src/keymap/defaults.ts`, `src/renderer/src/testHooks.ts`
- Test: `tests/e2e/windows.spec.ts`

**Interfaces:**
- `createWindowRegistry()` → `{ open(options: { startupPaths, projectRoot }): { windowId, window }; get(webContents): WindowInfo | null; all(): WindowInfo[]; pushTo(windowId, channel, payload) }`; `WindowInfo = { windowId: string; window: BrowserWindow; startupPaths: readonly string[]; projectRoot: string | null }`.
- `handle(channel, (request, ctx: { sender: WebContents; windowId: string }) => ...)`.
- `app.bootstrap` returns the window's own `startupPaths`/`projectRoot`/`windowId` (looked up by `sender`).
- `pty.spawn` records `owner = ctx.sender`; manager pushes `pty.data/exit` only to that `WebContents` (`push: (channel, payload, owner)`).
- Dirty store uses `windowId` (`createDirtyStore(userData, windowId)`); restore on startup reads **all** window dirs (`listAll()`), adopts them into the first window, and clears them.
- `window.new` command (`mod+shift+n`) → `invoke('window.new', undefined)` → main opens a window with no startup paths and the same `projectRoot`.
- Closing a window kills its PTYs (`manager.killOwnedBy(webContents)`).

- [x] **Step 1: Write the failing E2E**

`tests/e2e/windows.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')

test('window.new opens a second window whose terminals are isolated', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  const second = app.waitForEvent('window')
  await page.evaluate(() => window.__moruTest!.runCommand('window.new'))
  const page2 = await second
  await page2.waitForFunction(() => window.__moruTest?.ready() === true)

  expect(app.windows().length).toBe(2)
  expect(await page2.evaluate(() => window.__moruTest!.tabs()[0]?.tabs.length)).toBe(1)

  await page2.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await page2.evaluate(() => window.__moruTest!.terminalFocus())
  await page2.keyboard.type('echo second-window\n')
  await expect.poll(() => page2.evaluate(() => window.__moruTest!.terminalText()), { timeout: 10_000 }).toContain('second-window')

  expect(await page.evaluate(() => window.__moruTest!.terminals().length)).toBe(0)
  expect(await page.evaluate(() => window.__moruTest!.windowId())).not.toBe(await page2.evaluate(() => window.__moruTest!.windowId()))

  await page2.close()
  await expect.poll(() => app.windows().length).toBe(1)
  await app.close()
})
```

(`page2` opens with an untitled tab because it has no startup paths.)

- [x] **Step 2: Run to verify failure** → FAIL.

- [x] **Step 3: Implement** — as described in Interfaces. Key details: `handle` wrapper looks up `windowId` via the registry from `event.sender`; `pushToAll` stays for broadcast channels; the PTY manager gets `push: (channel, payload, owner: WebContents) => owner.isDestroyed() ? undefined : owner.send(channel, payload)`; `window.on('closed')` → `manager.killOwnedBy(contents)` and registry removal; `app.on('window-all-closed')` unchanged. Test hook `windowId()` from bootstrap.

- [x] **Step 4: Run** — full check → PASS.

- [x] **Step 5: Commit** — `feat(windows): multiple windows with per-window pty ownership and dirty stores`

---

### Task 5: Report

- [ ] `pnpm check`; write `docs/superpowers/reports/m2b-watcher-sidebar-windows.md` (results table incl. the four external-change scenarios, sidebar ops, windows; findings; the manual "Claude Code edits an open file" check status). Tick checkboxes. Commit `docs(m2b): add watcher, sidebar, windows report`.

## Self-Review Notes

- Spec §4.5 fully covered (T1 main side, T2 renderer flows incl. diff tab); §4.4 ④ expected writes (T1); §4.7 fs.watch/unwatch/tree/create/rename/delete (T1, T3); §3.4 `ui/sidebar` (T3); §4.6 다중 창 기본 (T4; full session per window is M3).
- Type consistency: `Banner` gains `external`/`deleted` (T2) and `Banner.tsx` handles all six kinds; `Tab` gains `diff` (T2) — every `tab.kind` switch (EditorHost, Banner, StatusBar, TabStrip, PaneView, testHooks, workspace) must add the case; `Bootstrap` gains `projectRoot` (T3) and `windowId` (T4).
- Test ids: `sidebar`, `tree-row`; hooks: `bannerKind`, `sidebarRows`, `projectRoot`, `windowId`.
