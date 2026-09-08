import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore } from '../../../src/main/session/sessionStore'
import type { WindowSnapshot } from '../../../src/shared/session'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moru-session-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const snap = (windowId: string): WindowSnapshot => ({
  windowId,
  projectRoot: null,
  sidebar: { open: true, expanded: [] },
  layout: { kind: 'leaf', active: null, tabs: [] },
  activePath: [],
})

describe('session store', () => {
  it('merges per-window snapshots and writes after the debounce', async () => {
    const store = createSessionStore(dir, { debounceMs: 50 })
    store.update('w1', snap('w1'), { x: 0, y: 0, width: 800, height: 600 })
    store.update('w2', snap('w2'), null)
    await new Promise((r) => setTimeout(r, 250))
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
    expect((await readdir(dir)).some((f) => f.startsWith('session.corrupt.'))).toBe(true)
  })
})
