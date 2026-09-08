import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import iconv from 'iconv-lite'
import { launchApp } from './launch'

const tempFile = (name: string, bytes: Buffer) => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-status-'))
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return path
}

test('EOL menu changes the pending line ending, marks dirty, and save writes CRLF', async () => {
  const path = tempFile('a.txt', Buffer.from('a\nb\n'))
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await expect(page.getByTestId('eol')).toHaveText('LF')

  await page.getByTestId('eol').click()
  await page.getByTestId('popup-item').filter({ hasText: 'CRLF' }).click()
  await expect(page.getByTestId('eol')).toHaveText('CRLF')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.dirty())).toBe(true)

  await page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.dirty())).toBe(false)
  expect(readFileSync(path, 'utf8')).toBe('a\r\nb\r\n')
  await app.close()
})

test('encoding menu: reinterpret re-reads bytes, save with UTF-8 BOM re-encodes', async () => {
  const path = tempFile('k.txt', iconv.encode('가나\n', 'cp949'))
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await expect(page.getByTestId('encoding')).toHaveText('CP949')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('가나\n')

  await page.getByTestId('encoding').click()
  await page.getByTestId('popup-item').filter({ hasText: 'Reinterpret as Latin-1' }).click()
  await expect(page.getByTestId('encoding')).toHaveText('Latin-1')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).not.toBe('가나\n')

  await page.getByTestId('encoding').click()
  await page.getByTestId('popup-item').filter({ hasText: 'Reinterpret as CP949' }).click()
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('가나\n')

  await page.getByTestId('encoding').click()
  await page.getByTestId('popup-item').filter({ hasText: 'Save with UTF-8 BOM' }).click()
  await expect(page.getByTestId('encoding')).toHaveText('UTF-8 BOM')
  await page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.dirty())).toBe(false)
  expect([...readFileSync(path).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  expect(readFileSync(path).subarray(3).toString('utf8')).toBe('가나\n')
  await app.close()
})

test('reinterpret is refused while the buffer is dirty', async () => {
  const path = tempFile('k.txt', iconv.encode('가\n', 'cp949'))
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.type('x')

  await page.evaluate(() => window.__moruTest!.runCommand('buffer.reinterpret', 'latin1'))
  await expect(page.getByTestId('status')).toContainText('save or revert')
  await expect(page.getByTestId('encoding')).toHaveText('CP949')
  await app.close()
})

test('syntax menu switches the language and indent menu sets tab size per buffer', async () => {
  const path = tempFile('plain.txt', Buffer.from('x'))
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await expect(page.getByTestId('language')).toHaveText('Plain Text')

  await page.getByTestId('language').click()
  await page.getByTestId('popup-item').filter({ hasText: 'Python' }).click()
  await expect(page.getByTestId('language')).toHaveText('Python')
  expect(await page.evaluate(() => window.__moruTest!.dirty())).toBe(false)

  await page.getByTestId('indent').click()
  await page.getByTestId('popup-item').filter({ hasText: 'Tab Width: 2' }).click()
  await expect(page.getByTestId('indent')).toHaveText('Spaces: 2')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.editorSettings().tabSize)).toBe(2)

  await page.getByTestId('indent').click()
  await page.getByTestId('popup-item').filter({ hasText: 'Indent Using Tabs' }).click()
  await expect(page.getByTestId('indent')).toHaveText('Tabs: 2')
  await app.close()
})
