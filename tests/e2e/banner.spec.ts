import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import iconv from 'iconv-lite'
import { launchApp } from './launch'

const tempFile = (name: string, bytes: Buffer) => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-banner-'))
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return path
}

test('conflict banner offers overwrite and reload', async () => {
  const path = tempFile('c.txt', Buffer.from('v1\n'))
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('x')
  writeFileSync(path, 'v2 from agent\n')

  await page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await expect(page.getByTestId('banner')).toContainText('changed on disk')
  expect(readFileSync(path, 'utf8')).toBe('v2 from agent\n')

  await page.getByTestId('banner-action').filter({ hasText: 'Reload from Disk' }).click()
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('v2 from agent\n')
  await expect(page.getByTestId('banner')).toHaveCount(0)
  expect(await page.evaluate(() => window.__moruTest!.dirty())).toBe(false)

  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('y')
  writeFileSync(path, 'v3\n')
  await page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await expect(page.getByTestId('banner')).toContainText('changed on disk')
  await page.getByTestId('banner-action').filter({ hasText: 'Overwrite' }).click()
  await expect(page.getByTestId('banner')).toHaveCount(0)
  expect(readFileSync(path, 'utf8')).toBe('yv2 from agent\n')

  await app.close()
})

test('lossy encoding banner can switch to UTF-8 and save', async () => {
  const path = tempFile('k.txt', iconv.encode('가\n', 'cp949'))
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('😀')

  await page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await expect(page.getByTestId('banner')).toContainText('cannot represent')
  expect(Buffer.compare(readFileSync(path), iconv.encode('가\n', 'cp949'))).toBe(0)

  await page.getByTestId('banner-action').filter({ hasText: 'Save as UTF-8' }).click()
  await expect(page.getByTestId('banner')).toHaveCount(0)
  await expect(page.getByTestId('encoding')).toHaveText('UTF-8')
  expect(readFileSync(path, 'utf8')).toBe('😀가\n')

  await app.close()
})
