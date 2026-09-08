import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const status = (page: Page) => page.getByTestId('search-status')
const summary = (page: Page) => page.evaluate(() => window.__moruTest!.searchState())

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'moru-search-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'a.ts'), 'const foo = 1\nfoo(foo)\n')
  writeFileSync(join(root, 'src', 'b.ts'), 'export const Foo = "foo"\n')
  writeFileSync(join(root, 'notes.md'), '# nothing\n')
  return root
}

test('streams results into a tree, corrects dirty buffers, opens a match', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root, MORU_TEST_OPEN: join(root, 'src', 'a.ts') })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('foo ')

  await page.keyboard.press(`${mod}+Shift+f`)
  await expect(page.getByTestId('search-pattern')).toBeFocused()
  await page.keyboard.type('foo')
  await page.keyboard.press('Enter')
  await expect(status(page)).toHaveText('6 matches in 2 files')
  expect((await summary(page))?.files).toEqual([
    { path: join(root, 'src', 'a.ts'), count: 4, source: 'buffer' },
    { path: join(root, 'src', 'b.ts'), count: 2, source: 'disk' },
  ])
  await expect(page.getByTestId('search-match')).toHaveCount(6)

  await page.getByTestId('search-match').nth(4).click()
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'src', 'b.ts'))
  expect((await page.evaluate(() => window.__moruTest!.selections()))[0]).toEqual({ from: 13, to: 16 })
  await app.close()
})

test('replace all edits open buffers without saving, rewrites closed files, and undo restores them', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root, MORU_TEST_OPEN: join(root, 'src', 'a.ts') })
  await page.keyboard.press(`${mod}+Shift+f`)
  await page.keyboard.type('foo')
  await page.getByTestId('search-toggle-preserve').click()
  await page.getByTestId('search-replace').fill('bar')
  await page.getByTestId('search-replace').press('Enter')
  await expect(status(page)).toHaveText('5 matches in 2 files')
  await expect(page.locator('[data-testid="search-match"] ins').filter({ hasText: /^Bar$/ })).toHaveCount(1)
  await expect(page.locator('[data-testid="search-match"] ins').filter({ hasText: /^bar$/ })).toHaveCount(4)

  await page
    .getByTestId('search-match')
    .filter({ has: page.locator('del', { hasText: /^Foo$/ }) })
    .getByTestId('search-match-toggle')
    .click()
  await page.getByTestId('search-replace-all').click()

  await expect.poll(() => readFileSync(join(root, 'src', 'b.ts'), 'utf8')).toBe('export const Foo = "bar"\n')
  await page.evaluate((p) => window.__moruTest!.openPath(p), join(root, 'src', 'a.ts'))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('const bar = 1\nbar(bar)\n')
  expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toBe('const foo = 1\nfoo(foo)\n')
  expect(await page.evaluate(() => window.__moruTest!.dirty())).toBe(true)

  await page.evaluate(() => window.__moruTest!.runCommand('search.undoReplace'))
  await expect.poll(() => readFileSync(join(root, 'src', 'b.ts'), 'utf8')).toBe('export const Foo = "foo"\n')
  await app.close()
})

test('search tab survives a session restore with its query', async () => {
  const root = project()
  const first = await launchApp({ MORU_TEST_ROOT: root })
  await first.page.keyboard.press(`${mod}+Shift+f`)
  await first.page.keyboard.type('foo')
  await first.page.keyboard.press('Enter')
  await expect(status(first.page)).toContainText('matches')
  await first.page.waitForTimeout(1200)
  await first.app.close()

  const second = await launchApp({ MORU_TEST_ROOT: root }, { userData: first.userData })
  await expect(second.page.getByTestId('search-pattern')).toHaveValue('foo')
  expect(await second.page.evaluate(() => window.__moruTest!.searchTabs())).toBe(1)
  await second.app.close()
})
