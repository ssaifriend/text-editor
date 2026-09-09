import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const dirtyFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-close-'))
  const path = join(dir, 'c.txt')
  writeFileSync(path, 'v1\n')
  return path
}

const edit = async (page: Page) => {
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('x')
}

test('closing a dirty tab with dontSave discards the edit', async () => {
  const path = dirtyFile()
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path, MORU_TEST_CONFIRM: 'dontSave' })
  await edit(page)

  await page.evaluate(() => window.__moruTest!.runCommand('tab.close'))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs()[0]?.tabs.map((t) => t.title))).toEqual(['untitled'])
  expect(readFileSync(path, 'utf8')).toBe('v1\n')

  await app.close()
})

test('closing a dirty tab with save writes the file first', async () => {
  const path = dirtyFile()
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path, MORU_TEST_CONFIRM: 'save' })
  await edit(page)

  await page.evaluate(() => window.__moruTest!.runCommand('tab.close'))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs()[0]?.tabs.map((t) => t.title))).toEqual(['untitled'])
  expect(readFileSync(path, 'utf8')).toBe('xv1\n')

  await app.close()
})

test('cancel keeps the tab', async () => {
  const path = dirtyFile()
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path, MORU_TEST_CONFIRM: 'cancel' })
  await edit(page)

  await page.evaluate(() => window.__moruTest!.runCommand('tab.close'))
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => window.__moruTest!.tabs()[0]?.tabs.length)).toBe(1)

  await app.close()
})
