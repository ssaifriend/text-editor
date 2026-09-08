import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTextFile } from '../../../src/main/fs/read'
import { writeTextFile } from '../../../src/main/fs/write'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moru-fs-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readTextFile', () => {
  it('returns ok with path and utf8 text', async () => {
    const path = join(dir, 'a.txt')
    await writeFile(path, '한글 hello\n', 'utf8')

    const result = await readTextFile(path)

    expect(result).toEqual({ ok: true, value: { path, text: '한글 hello\n' } })
  })

  it('returns io error for a missing file', async () => {
    const result = await readTextFile(join(dir, 'missing.txt'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('io')
  })
})

describe('writeTextFile', () => {
  it('writes utf8 text and reports byte count', async () => {
    const path = join(dir, 'b.txt')

    const result = await writeTextFile({ path, text: '한' })

    expect(result).toEqual({ ok: true, value: { path, bytes: 3 } })
    expect(await readFile(path, 'utf8')).toBe('한')
  })

  it('returns io error when the directory does not exist', async () => {
    const result = await writeTextFile({ path: join(dir, 'no', 'such', 'dir.txt'), text: 'x' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('io')
  })
})
