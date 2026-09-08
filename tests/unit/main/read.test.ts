import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import iconv from 'iconv-lite'
import { readTextFile } from '../../../src/main/fs/read'
import { hashBytes } from '../../../src/main/fs/hash'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moru-read-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readTextFile', () => {
  it('reads utf8 crlf and normalizes to lf while remembering eol and hash', async () => {
    const path = join(dir, 'a.txt')
    const bytes = Buffer.from('one\r\ntwo\r\n', 'utf8')
    await writeFile(path, bytes)

    const result = await readTextFile(path)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      path,
      text: 'one\ntwo\n',
      encoding: 'utf8',
      bom: false,
      eol: 'crlf',
      mixedEol: false,
      confidence: 'high',
      hash: hashBytes(bytes),
      readonly: false,
      largeFile: false,
    })
    expect(result.value.mtimeMs).toBeGreaterThan(0)
  })

  it('reads cp949 and reports it', async () => {
    const path = join(dir, 'k.txt')
    await writeFile(path, iconv.encode('한글 파일\n', 'cp949'))

    const result = await readTextFile(path)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toMatchObject({ text: '한글 파일\n', encoding: 'cp949', bom: false })
  })

  it('honors a forced encoding', async () => {
    const path = join(dir, 'k.txt')
    await writeFile(path, iconv.encode('한글\n', 'cp949'))

    const result = await readTextFile(path, 'latin1')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.encoding).toBe('latin1')
  })

  it('reports readonly files', async () => {
    const path = join(dir, 'ro.txt')
    await writeFile(path, 'x')
    await chmod(path, 0o444)

    const result = await readTextFile(path)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.readonly).toBe(process.platform !== 'win32')
  })

  it('rejects binary files', async () => {
    const path = join(dir, 'bin')
    await writeFile(path, Buffer.from([0x00, 0x01, 0x02, 0x41]))

    const result = await readTextFile(path)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('binary')
  })

  it('returns io error for a missing file', async () => {
    const result = await readTextFile(join(dir, 'missing'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('io')
  })
})
