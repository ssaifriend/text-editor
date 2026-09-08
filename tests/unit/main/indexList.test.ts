import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rgPath } from '@vscode/ripgrep'
import { listFiles } from '../../../src/main/index/list'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moru-index-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

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
