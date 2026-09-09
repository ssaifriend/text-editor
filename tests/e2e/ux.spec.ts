import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'moru-ux-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'a.ts'), 'see ./b.ts:2:3 and ../README.md\n')
  writeFileSync(join(root, 'src', 'b.ts'), 'line one\nline two here\n')
  writeFileSync(join(root, 'README.md'), '# r\n')
  return root
}

test('closing the last tab leaves an untitled buffer; status bar shows a root-relative path at fixed height', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root, MORU_TEST_OPEN: join(root, 'src', 'a.ts') })
  await expect(page.getByTestId('path')).toHaveText('src/a.ts')
  const height = await page.evaluate(() => document.querySelector('.statusbar')!.getBoundingClientRect().height)
  expect(Math.round(height)).toBe(24)

  await page.evaluate(() => window.__moruTest!.runCommand('tab.close'))
  await expect.poll(async () => (await page.evaluate(() => window.__moruTest!.tabs()))[0]?.tabs.map((t) => t.title)).toEqual(['untitled'])
  await expect(page.getByTestId('path')).toHaveText('untitled')
  await app.close()
})

test('sidebar rows carry icons and highlight the active file', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root, MORU_TEST_OPEN: join(root, 'README.md') })
  await expect(page.locator('.tree-row .tree-icon.dir')).toHaveCount(1)
  await expect(page.locator('.tree-row .tree-icon.file')).toHaveCount(1)
  await expect(page.getByTestId('tree-row').filter({ hasText: 'README.md' })).toHaveClass(/active/)
  const rowHeight = await page.getByTestId('tree-row').first().evaluate((el) => el.getBoundingClientRect().height)
  expect(Math.round(rowHeight)).toBe(24)
  await app.close()
})

test('mod+click on a path-like token opens the file at the referenced line', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root, MORU_TEST_OPEN: join(root, 'src', 'a.ts') })
  await expect(page.locator('.cm-path-link')).toHaveCount(2)

  await page.locator('.cm-path-link').first().click({ modifiers: [modifier] })
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'src', 'b.ts'))
  await expect(page.getByTestId('pos')).toHaveText('Ln 2, Col 3')

  await page.evaluate(() => window.__moruTest!.runCommand('tab.prev'))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'src', 'a.ts'))
  await page.locator('.cm-path-link').nth(1).click({ modifiers: [modifier] })
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'README.md'))
  await app.close()
})
