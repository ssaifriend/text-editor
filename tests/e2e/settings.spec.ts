import { test, expect } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

test('indentation is detected per file on open', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-indent-'))
  const twoSpaces = join(dir, 'two.ts')
  const tabs = join(dir, 'tabs.ts')
  writeFileSync(twoSpaces, 'function f() {\n  if (x) {\n    y()\n  }\n}\n')
  writeFileSync(tabs, 'function f() {\n\tif (x) {\n\t\ty()\n\t}\n}\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: twoSpaces })
  await expect.poll(() => page.evaluate(() => window.__moruTest!.editorSettings().tabSize)).toBe(2)
  await expect(page.getByTestId('indent')).toHaveText('Spaces: 2')

  await page.evaluate((p) => window.__moruTest!.openPath(p), tabs)
  await expect(page.getByTestId('indent')).toHaveText('Tabs: 4')
  expect(await page.evaluate(() => window.__moruTest!.editorSettings().indentUnit)).toBe('\t')
  await app.close()
})
