import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { launchApp } from './launch'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const fixture = resolve('tests/e2e/fixtures/ime.ts')

test('split selection into lines then type at every cursor', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setSelection(0, 35))
  await page.keyboard.press(`${mod}+Shift+l`)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.selections().length)).toBe(2)
  await page.keyboard.type(' // x')
  await expect
    .poll(() => page.evaluate(() => window.__moruTest!.doc()))
    .toContain('const greeting = ""; // x\nconst foo = 1; // x\n')
  await app.close()
})
