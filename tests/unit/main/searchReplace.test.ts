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
    const expected = createExpectedWrites()
    const service = createReplaceService({ expected })

    const report = await service.replace({
      spec,
      replacement: 'bar',
      preserveCase: true,
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
    expect(expected.consume(a.path, hashBytes(readFileSync(a.path)))).toBe(true)
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

  it('keeps only the newest five operations', async () => {
    const files = Array.from({ length: 6 }, (_, i) => write(`f${i}.txt`, Buffer.from('foo\n')))
    const service = createReplaceService({ expected: createExpectedWrites() })
    for (const f of files) await service.replace({ spec, replacement: 'bar', preserveCase: false, files: [{ ...f, lines: [{ line: 1, skip: [] }] }] })
    const undone: (string | undefined)[] = []
    for (let i = 0; i < 7; i++) undone.push((await service.undoLast())?.changed[0]?.path)
    expect(undone.filter(Boolean)).toEqual(files.slice(1).reverse().map((f) => f.path))
    expect(readFileSync(files[0]!.path, 'utf8')).toBe('bar\n')
  })
})
