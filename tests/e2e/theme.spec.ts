import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')

test('theme setting switches css variables and the CodeMirror theme', async () => {
  const { app, page, userData } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset['theme'])).toBe('moru-dark')
  const darkBg = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-editor')!).backgroundColor)

  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ theme: 'moru-light' }))
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['theme']), { timeout: 10_000 })
    .toBe('moru-light')
  const lightBg = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-editor')!).backgroundColor)

  expect(lightBg).not.toBe(darkBg)
  expect(lightBg).toBe('rgb(251, 251, 251)')
  expect(darkBg).toBe('rgb(30, 34, 39)')
  await app.close()
})
