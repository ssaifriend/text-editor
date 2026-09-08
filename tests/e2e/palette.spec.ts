import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('palette opens with mod+shift+p, filters fuzzily, and runs the selected command', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs().length)).toBe(1)

  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+Shift+p`)
  await expect(page.getByTestId('palette')).toBeVisible()
  await expect(page.getByTestId('palette-input')).toBeFocused()

  await page.keyboard.type('spl rgt')
  await expect(page.getByTestId('palette-item').first()).toContainText('View: Split Right')

  await page.keyboard.press('Enter')
  await expect(page.getByTestId('palette')).toBeHidden()
  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs().length)).toBe(2)

  await app.close()
})

test('escape closes the palette and returns focus to the editor', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await page.evaluate(() => window.__moruTest!.focus())

  await page.evaluate(() => window.__moruTest!.runCommand('palette.commands'))
  await expect(page.getByTestId('palette')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette')).toBeHidden()
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('cm-content') ?? false)).toBe(true)

  await app.close()
})

test('editor-only commands are listed while the editor is focused', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await page.evaluate(() => window.__moruTest!.focus())

  await page.keyboard.press(`${mod}+Shift+p`)
  await page.keyboard.type('toggle comment')
  await expect(page.getByTestId('palette-item').first()).toContainText('Toggle Comment')

  await app.close()
})
