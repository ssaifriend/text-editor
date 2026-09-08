import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')

test('settings.json changes reconfigure open editors without losing text or undo', async () => {
  const { app, page, userData } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(() => page.evaluate(() => window.__moruTest!.editorSettings().tabSize)).toBe(4)
  await expect(page.locator('.cm-gutters')).toHaveCount(1)

  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('// edited ')

  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ editor: { tabSize: 2, lineNumbers: false, wordWrap: true } }))

  await expect
    .poll(() => page.evaluate(() => window.__moruTest!.editorSettings()), { timeout: 10_000 })
    .toMatchObject({ tabSize: 2, indentUnit: '  ', lineNumbers: false, wordWrap: true })
  await expect(page.locator('.cm-gutters')).toHaveCount(0)
  expect(await page.evaluate(() => window.__moruTest!.doc())).toContain('// edited ')

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).not.toContain('// edited')

  await app.close()
})

test('language overrides apply per buffer', async () => {
  const { app, page, userData } = await launchApp({ MORU_TEST_OPEN: fixture })
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ editor: { tabSize: 4 }, languages: { typescript: { tabSize: 3 } } }))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.editorSettings().tabSize), { timeout: 10_000 }).toBe(3)

  await page.evaluate(() => window.__moruTest!.runCommand('file.new'))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.editorSettings().tabSize)).toBe(4)

  await app.close()
})
