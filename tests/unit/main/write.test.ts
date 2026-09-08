import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, readdir, stat, symlink, chmod, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import iconv from 'iconv-lite'
import { readTextFile } from '../../../src/main/fs/read'
import { writeTextFile } from '../../../src/main/fs/write'
import { hashBytes } from '../../../src/main/fs/hash'
import type { SaveRequest } from '../../../src/shared/ipc'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moru-write-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const requestFrom = (file: { path: string; text: string; encoding: SaveRequest['encoding']; bom: boolean; eol: SaveRequest['eol']; hash: string }): SaveRequest => ({
  path: file.path,
  text: file.text,
  encoding: file.encoding,
  bom: file.bom,
  eol: file.eol,
  expectedHash: file.hash,
  mode: 'normal',
})

const notWindows = process.platform !== 'win32'

describe('writeTextFile', () => {
  it('reproduces the original bytes for an unedited cp949 crlf file', async () => {
    const path = join(dir, 'k.txt')
    const original = iconv.encode('첫 줄\r\n둘째 줄\r\n', 'cp949')
    await writeFile(path, original)
    const opened = await readTextFile(path)
    if (!opened.ok) throw new Error('open failed')

    const saved = await writeTextFile(requestFrom(opened.value))

    expect(saved.ok).toBe(true)
    expect(Buffer.compare(await readFile(path), original)).toBe(0)
    if (saved.ok) expect(saved.value).toMatchObject({ path, bytes: original.length, hash: hashBytes(original) })
  })

  it('reproduces utf8 BOM and lone cr files', async () => {
    const path = join(dir, 'b.txt')
    const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\rb\r', 'utf8')])
    await writeFile(path, original)
    const opened = await readTextFile(path)
    if (!opened.ok) throw new Error('open failed')

    await writeTextFile(requestFrom(opened.value))

    expect(Buffer.compare(await readFile(path), original)).toBe(0)
  })

  it('writes edits in the original encoding and eol', async () => {
    const path = join(dir, 'e.txt')
    await writeFile(path, iconv.encode('가\r\n', 'cp949'))
    const opened = await readTextFile(path)
    if (!opened.ok) throw new Error('open failed')

    await writeTextFile({ ...requestFrom(opened.value), text: '가\n나\n' })

    expect(Buffer.compare(await readFile(path), iconv.encode('가\r\n나\r\n', 'cp949'))).toBe(0)
  })

  it('creates a new file when expectedHash is null', async () => {
    const path = join(dir, 'new.txt')

    const saved = await writeTextFile({ path, text: 'x\n', encoding: 'utf8', bom: false, eol: 'lf', expectedHash: null, mode: 'normal' })

    expect(saved.ok).toBe(true)
    expect(await readFile(path, 'utf8')).toBe('x\n')
  })

  it('returns conflict when the file changed since it was read', async () => {
    const path = join(dir, 'c.txt')
    await writeFile(path, 'v1')
    const opened = await readTextFile(path)
    if (!opened.ok) throw new Error('open failed')
    await writeFile(path, 'v2 from elsewhere')

    const saved = await writeTextFile({ ...requestFrom(opened.value), text: 'mine' })

    expect(saved.ok).toBe(false)
    if (!saved.ok) {
      expect(saved.error.kind).toBe('conflict')
      if (saved.error.kind === 'conflict') expect(saved.error.diskHash).toBe(hashBytes(Buffer.from('v2 from elsewhere')))
    }
    expect(await readFile(path, 'utf8')).toBe('v2 from elsewhere')
  })

  it('overwrite mode ignores the conflict', async () => {
    const path = join(dir, 'c.txt')
    await writeFile(path, 'v1')
    const opened = await readTextFile(path)
    if (!opened.ok) throw new Error('open failed')
    await writeFile(path, 'v2')

    const saved = await writeTextFile({ ...requestFrom(opened.value), text: 'mine', mode: 'overwrite' })

    expect(saved.ok).toBe(true)
    expect(await readFile(path, 'utf8')).toBe('mine')
  })

  it('returns encodingLossy with positions and leaves the file untouched', async () => {
    const path = join(dir, 'l.txt')
    await writeFile(path, iconv.encode('가', 'cp949'))
    const opened = await readTextFile(path)
    if (!opened.ok) throw new Error('open failed')

    const saved = await writeTextFile({ ...requestFrom(opened.value), text: '가😀' })

    expect(saved.ok).toBe(false)
    if (!saved.ok && saved.error.kind === 'encodingLossy') expect(saved.error.positions).toEqual([1])
    expect(Buffer.compare(await readFile(path), iconv.encode('가', 'cp949'))).toBe(0)
  })

  it('leaves no tmp files behind', async () => {
    const path = join(dir, 't.txt')
    await writeTextFile({ path, text: 'x', encoding: 'utf8', bom: false, eol: 'lf', expectedHash: null, mode: 'normal' })

    expect((await readdir(dir)).sort()).toEqual(['t.txt'])
  })

  it.skipIf(!notWindows)('preserves the file mode', async () => {
    const path = join(dir, 'x.sh')
    await writeFile(path, '#!/bin/sh\n')
    await chmod(path, 0o755)
    const opened = await readTextFile(path)
    if (!opened.ok) throw new Error('open failed')

    await writeTextFile({ ...requestFrom(opened.value), text: '#!/bin/sh\necho hi\n' })

    expect((await stat(path)).mode & 0o777).toBe(0o755)
  })

  it.skipIf(!notWindows)('writes through a symlink to its target', async () => {
    const target = join(dir, 'target.txt')
    const link = join(dir, 'link.txt')
    await writeFile(target, 'old')
    await symlink(target, link)
    const opened = await readTextFile(link)
    if (!opened.ok) throw new Error('open failed')

    await writeTextFile({ ...requestFrom(opened.value), text: 'new' })

    expect(await readFile(target, 'utf8')).toBe('new')
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
  })

  it('returns io error when the directory does not exist', async () => {
    const saved = await writeTextFile({ path: join(dir, 'no', 'dir.txt'), text: 'x', encoding: 'utf8', bom: false, eol: 'lf', expectedHash: null, mode: 'normal' })
    expect(saved.ok).toBe(false)
    if (!saved.ok) expect(saved.error.kind).toBe('io')
  })
})
