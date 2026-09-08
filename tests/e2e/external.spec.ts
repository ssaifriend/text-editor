import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const tempFile = (name: string, text: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-ext-'))
  const path = join(dir, name)
  writeFileSync(path, text)
  return path
}
const doc = (page: Page) => page.evaluate(() => window.__moruTest!.doc())
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('a clean buffer silently reloads an external edit, keeps the cursor, and stays undoable', async () => {
  const path = tempFile('a.ts', 'const a = 1\nconst b = 2\nconst c = 3\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(30))

  writeFileSync(path, 'const a = 1\nconst b = 22\nconst c = 3\nconst d = 4\n')
  await expect.poll(() => doc(page), { timeout: 10_000 }).toBe('const a = 1\nconst b = 22\nconst c = 3\nconst d = 4\n')
  expect(await page.evaluate(() => window.__moruTest!.selections()[0]?.from)).toBe(31)
  expect(await page.evaluate(() => window.__moruTest!.dirty())).toBe(false)
  await expect(page.getByTestId('banner')).toHaveCount(0)

  await page.keyboard.press(`${mod}+z`)
  await expect.poll(() => doc(page)).toBe('const a = 1\nconst b = 2\nconst c = 3\n')
  expect(await page.evaluate(() => window.__moruTest!.dirty())).toBe(true)
  await app.close()
})

test('a dirty buffer gets a banner: compare, keep mine, then later clean reload works', async () => {
  const path = tempFile('b.txt', 'v1\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('mine ')

  writeFileSync(path, 'v2 from agent\n')
  await expect(page.getByTestId('banner')).toContainText('changed on disk', { timeout: 10_000 })
  expect(await doc(page)).toBe('mine v1\n')

  await page.getByTestId('banner-action').filter({ hasText: 'Compare' }).click()
  await expect(page.locator('.cm-merge-a')).toHaveCount(1)
  await page.evaluate(() => window.__moruTest!.runCommand('tab.close'))

  await page.evaluate(() => window.__moruTest!.runCommand('tab.select', 1))
  await page.getByTestId('banner-action').filter({ hasText: 'Keep Mine' }).click()
  await expect(page.getByTestId('banner')).toHaveCount(0)
  await page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await expect.poll(() => readFileSync(path, 'utf8')).toBe('mine v1\n')

  writeFileSync(path, 'v3\n')
  await expect.poll(() => doc(page), { timeout: 10_000 }).toBe('v3\n')
  await app.close()
})

test('a deleted file shows a banner and save recreates it', async () => {
  const path = tempFile('c.txt', 'keep me\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  unlinkSync(path)
  await expect(page.getByTestId('banner')).toContainText('deleted', { timeout: 10_000 })

  await page.getByTestId('banner-action').filter({ hasText: 'Save' }).click()
  await expect(page.getByTestId('banner')).toHaveCount(0)
  expect(readFileSync(path, 'utf8')).toBe('keep me\n')
  await app.close()
})

test('own saves do not trigger a reload or banner', async () => {
  const path = tempFile('d.txt', 'x\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('y')
  await page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await page.waitForTimeout(800)
  await expect(page.getByTestId('banner')).toHaveCount(0)
  expect(await doc(page)).toBe('yx\n')
  await app.close()
})
