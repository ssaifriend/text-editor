import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import iconv from 'iconv-lite'
import { launchApp } from './launch'

const korean = '첫 줄\n둘째 줄\n'

const fixtures = [
  { name: 'cp949-crlf.txt', bytes: iconv.encode(korean.replace(/\n/g, '\r\n'), 'cp949'), encoding: 'CP949', eol: 'CRLF' },
  { name: 'utf8-bom-cr.txt', bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(korean.replace(/\n/g, '\r'), 'utf8')]), encoding: 'UTF-8 BOM', eol: 'CR' },
  { name: 'utf16le-bom-lf.txt', bytes: iconv.encode(korean, 'utf16le', { addBOM: true }), encoding: 'UTF-16 LE BOM', eol: 'LF' },
]

for (const fixture of fixtures) {
  test(`saving ${fixture.name} unedited reproduces the exact bytes`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'moru-rt-'))
    const path = join(dir, fixture.name)
    writeFileSync(path, fixture.bytes)

    const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
    await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe(korean)
    await expect(page.getByTestId('encoding')).toHaveText(fixture.encoding)
    await expect(page.getByTestId('eol')).toHaveText(fixture.eol)

    await page.getByTestId('save').click()
    await expect(page.getByTestId('status')).toContainText('saved')

    expect(Buffer.compare(readFileSync(path), fixture.bytes)).toBe(0)
    await app.close()
  })
}

test('edits are written back in the original encoding and eol', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-rt-'))
  const path = join(dir, 'k.txt')
  writeFileSync(path, iconv.encode('가\r\n', 'cp949'))

  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('가\n')

  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(2))
  await page.keyboard.type('나')
  await page.getByTestId('save').click()
  await expect(page.getByTestId('status')).toContainText('saved')

  expect(Buffer.compare(readFileSync(path), iconv.encode('가\r\n나', 'cp949'))).toBe(0)
  await app.close()
})

test('a file changed on disk is reported as a conflict and not overwritten', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-rt-'))
  const path = join(dir, 'c.txt')
  writeFileSync(path, 'v1\n')

  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('v1\n')

  writeFileSync(path, 'v2 from agent\n')
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('x')
  await page.getByTestId('save').click()

  await expect(page.getByTestId('status')).toContainText('conflict')
  expect(readFileSync(path, 'utf8')).toBe('v2 from agent\n')

  await page.evaluate(() => window.__moruTest!.saveAs('overwrite'))
  await expect(page.getByTestId('status')).toContainText('saved')
  expect(readFileSync(path, 'utf8')).toBe('xv1\n')

  await app.close()
})
