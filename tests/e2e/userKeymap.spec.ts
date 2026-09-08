import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('keymap.json bindings overlay the defaults and hot-reload', async () => {
  const { app, page, userData } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs().length)).toBe(1)

  writeFileSync(
    join(userData, 'keymap.json'),
    JSON.stringify([
      { keys: 'mod+shift+9', command: 'view.splitRight' },
      { keys: 'mod+d', command: 'view.splitDown', when: 'editorFocus' },
    ]),
  )
  await expect
    .poll(() => page.evaluate(() => window.__moruTest!.bindingFor('view.splitRight')), { timeout: 10_000 })
    .toBe('mod+shift+9')

  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+Shift+9`)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs().length)).toBe(2)

  await page.evaluate(() => window.__moruTest!.runCommand('view.focusPane', 1))
  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+d`)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs().length)).toBe(3)

  await page.evaluate(() => window.__moruTest!.runCommand('keymap.showConflicts'))
  await expect(page.getByTestId('status')).toContainText('no keymap conflicts')
  await app.close()
})

test('a conflicting user binding is reported', async () => {
  const { app, page, userData } = await launchApp({ MORU_TEST_OPEN: fixture })
  writeFileSync(
    join(userData, 'keymap.json'),
    JSON.stringify([
      { keys: 'mod+shift+7', command: 'view.splitRight' },
      { keys: 'mod+shift+7', command: 'view.splitDown' },
    ]),
  )
  await expect
    .poll(() => page.evaluate(() => window.__moruTest!.bindingFor('view.splitDown')), { timeout: 10_000 })
    .toBe('mod+shift+7')

  await page.evaluate(() => window.__moruTest!.runCommand('keymap.showConflicts'))
  await expect(page.getByTestId('status')).toContainText('1 keymap conflict')
  await app.close()
})
