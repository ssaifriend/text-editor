import { test, expect, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const doc = (page: Page) => page.evaluate(() => window.__moruTest!.doc())

test('Sublime bindings reach CodeMirror commands', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(() => doc(page)).toContain('const foo = 1;')

  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))

  await page.keyboard.press(`${mod}+/`)
  await expect.poll(() => doc(page)).toContain('// const greeting = "";')

  await page.keyboard.press(`${mod}+/`)
  await expect.poll(() => doc(page)).not.toContain('// const greeting')

  await page.keyboard.press(`${mod}+Shift+d`)
  await expect.poll(() => doc(page)).toBe('const greeting = "";\nconst greeting = "";\nconst foo = 1;\nconst bar = foo + foo;\n')

  await page.keyboard.press('Control+Shift+k')
  await expect.poll(() => doc(page)).toBe('const greeting = "";\nconst foo = 1;\nconst bar = foo + foo;\n')

  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.press(`${mod}+l`)
  const sel = await page.evaluate(() => window.__moruTest!.selections())
  expect(sel[0]).toEqual({ from: 0, to: 21 })

  await app.close()
})

test('bindings do not fire while the editor is not focused', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(() => doc(page)).toContain('const foo = 1;')

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press(`${mod}+/`)
  await page.waitForTimeout(100)
  expect(await doc(page)).not.toContain('//')

  await app.close()
})
