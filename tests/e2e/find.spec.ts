import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const doc = (page: Page) => page.evaluate(() => window.__moruTest!.doc())
const sel = (page: Page) => page.evaluate(() => window.__moruTest!.selections())

const file = (text: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-find-'))
  const path = join(dir, 'f.txt')
  writeFileSync(path, text)
  return path
}

test('find panel: live count, next/previous, wrap, escape returns focus', async () => {
  const path = file('foo Foo FOO foobar\nfoo\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+f`)
  await expect(page.getByTestId('find-panel')).toBeVisible()
  await expect(page.getByTestId('find-input')).toBeFocused()

  await page.keyboard.type('foo')
  await expect(page.getByTestId('find-count')).toHaveText('5')
  await expect(page.locator('.cm-searchMatch')).toHaveCount(5)

  await page.keyboard.press('Enter')
  await expect(page.getByTestId('find-count')).toHaveText('1 / 5')
  expect((await sel(page))[0]).toEqual({ from: 0, to: 3 })
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('find-count')).toHaveText('2 / 5')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Shift+Enter')
  await expect(page.getByTestId('find-count')).toHaveText('5 / 5')

  await page.getByTestId('find-toggle-case').click()
  await expect(page.getByTestId('find-count')).toHaveText('3 / 3')
  await page.getByTestId('find-toggle-word').click()
  await expect(page.getByTestId('find-count')).toHaveText('2 / 2')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('find-panel')).toBeHidden()
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('cm-content') ?? false)).toBe(true)
  await app.close()
})

test('alt+enter selects all matches; typing edits every cursor', async () => {
  const path = file('a x a x a\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+f`)
  await page.keyboard.type('a')
  await page.keyboard.press('Alt+Enter')
  await expect(page.getByTestId('find-panel')).toBeHidden()
  await expect.poll(() => sel(page).then((s) => s.length)).toBe(3)
  await page.keyboard.type('b')
  await expect.poll(() => doc(page)).toBe('b x b x b\n')
  await app.close()
})

test('replace next and replace all with regexp groups and preserve case', async () => {
  const path = file('id1 Id2 ID3\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+Alt+f`)
  await expect(page.getByTestId('replace-input')).toBeVisible()

  await page.getByTestId('find-input').fill('id(\\d)')
  await page.getByTestId('find-toggle-regexp').click()
  await page.getByTestId('find-toggle-preserve').click()
  await page.getByTestId('replace-input').fill('key$1')
  await expect(page.getByTestId('find-count')).toHaveText('3')

  await page.getByTestId('find-replace').click()
  await expect.poll(() => doc(page)).toBe('key1 Id2 ID3\n')
  await page.getByTestId('find-replace-all').click()
  await expect.poll(() => doc(page)).toBe('key1 Key2 KEY3\n')
  await app.close()
})

test('in-selection restricts matches', async () => {
  const path = file('foo\nfoo\nfoo\n')
  const { app, page } = await launchApp({ MORU_TEST_OPEN: path })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setSelection(0, 8))
  await page.keyboard.press(`${mod}+f`)
  await page.getByTestId('find-toggle-selection').click()
  await page.getByTestId('find-input').fill('foo')
  await expect(page.getByTestId('find-count')).toHaveText('2')
  await app.close()
})

test('recent queries are kept across restarts', async () => {
  const path = file('x\n')
  const first = await launchApp({ MORU_TEST_OPEN: path })
  await first.page.evaluate(() => window.__moruTest!.focus())
  await first.page.keyboard.press(`${mod}+f`)
  await first.page.keyboard.type('needle')
  await first.page.keyboard.press('Enter')
  await first.page.waitForTimeout(1200)
  await first.app.close()

  const second = await launchApp({}, { userData: first.userData })
  expect(await second.page.evaluate(() => window.__moruTest!.findHistory())).toEqual(['needle'])
  await second.app.close()
})
