import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listDirectory } from '../../../src/main/fs/tree'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moru-tree-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

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
    if (result.ok)
      expect(result.value.map((e) => [e.name, e.kind])).toEqual([
        ['Docs', 'dir'],
        ['src', 'dir'],
        ['.env', 'file'],
        ['A.md', 'file'],
        ['b.ts', 'file'],
      ])
  })

  it('returns io error for a missing directory', async () => {
    const result = await listDirectory(join(dir, 'nope'))
    expect(result.ok).toBe(false)
  })
})
