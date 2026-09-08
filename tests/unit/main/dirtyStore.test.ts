import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDirtyStore } from '../../../src/main/session/dirtyStore'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moru-dirty-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const entry = { id: 'b1', path: '/tmp/a.ts', text: 'unsaved 한글', selection: { anchor: 3, head: 5 } }

describe('dirty store', () => {
  it('writes, lists and clears entries', async () => {
    const store = createDirtyStore(dir)

    await store.write(entry)
    await store.write({ ...entry, id: 'b2', path: null })
    expect((await store.list()).map((e) => e.id).sort()).toEqual(['b1', 'b2'])
    expect((await store.list()).find((e) => e.id === 'b1')).toEqual(entry)

    await store.clear('b1')
    expect((await store.list()).map((e) => e.id)).toEqual(['b2'])
  })

  it('lists nothing when the directory does not exist yet', async () => {
    expect(await createDirtyStore(dir).list()).toEqual([])
  })

  it('skips corrupt files but keeps them on disk', async () => {
    const store = createDirtyStore(dir)
    await store.write(entry)
    await writeFile(join(dir, 'dirty', 'main', 'bad.json'), '{ not json')

    expect((await store.list()).map((e) => e.id)).toEqual(['b1'])
    expect((await readdir(join(dir, 'dirty', 'main'))).sort()).toEqual(['b1.json', 'bad.json'])
  })

  it('clear is idempotent', async () => {
    const store = createDirtyStore(dir)
    await expect(store.clear('nope')).resolves.toBeUndefined()
  })
})
