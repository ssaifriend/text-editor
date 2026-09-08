import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { launchApp } from './launch'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const tabKey = process.platform === 'darwin' ? 'Meta' : 'Alt'
const tabs = (page: Page) => page.evaluate(() => window.__moruTest!.tabs())

const twoFiles = () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-tabs-'))
  const a = join(dir, 'a.ts')
  const b = join(dir, 'b.md')
  writeFileSync(a, 'const a = 1\n')
  writeFileSync(b, '# b\n')
  return { a, b, both: `${a}${delimiter}${b}` }
}

test('startup paths open as tabs with the last one active', async () => {
  const { b, both } = twoFiles()
  const { app, page } = await launchApp({ MORU_TEST_OPEN: both })

  await expect.poll(async () => (await tabs(page))[0]?.tabs.map((t) => t.title)).toEqual(['a.ts', 'b.md'])
  expect((await tabs(page))[0]?.tabs.find((t) => t.active)?.title).toBe('b.md')
  await expect(page.getByTestId('path')).toHaveText(b)

  await app.close()
})

test('switching tabs keeps each buffer text, dirty flag and undo history', async () => {
  const { both } = twoFiles()
  const { app, page } = await launchApp({ MORU_TEST_OPEN: both })
  await expect.poll(async () => (await tabs(page))[0]?.tabs.length).toBe(2)

  await page.keyboard.press(`${tabKey}+1`)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('const a = 1\n')
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('// x ')
  await expect.poll(async () => (await tabs(page))[0]?.tabs[0]?.dirty).toBe(true)

  await page.keyboard.press(`${tabKey}+2`)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('# b\n')
  expect((await tabs(page))[0]?.tabs[1]?.dirty).toBe(false)

  await page.keyboard.press(`${tabKey}+1`)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('// x const a = 1\n')
  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+z`)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('const a = 1\n')
  await expect.poll(async () => (await tabs(page))[0]?.tabs[0]?.dirty).toBe(false)

  await app.close()
})

test('tab.close removes the active tab and ctrl+tab cycles', async () => {
  const { both } = twoFiles()
  const { app, page } = await launchApp({ MORU_TEST_OPEN: both })
  await expect.poll(async () => (await tabs(page))[0]?.tabs.length).toBe(2)

  await page.keyboard.press('Control+Tab')
  await expect.poll(async () => (await tabs(page))[0]?.tabs.find((t) => t.active)?.title).toBe('a.ts')

  await page.evaluate(() => window.__moruTest!.runCommand('tab.close'))
  await expect.poll(async () => (await tabs(page))[0]?.tabs.map((t) => t.title)).toEqual(['b.md'])

  await page.evaluate(() => window.__moruTest!.runCommand('file.new'))
  await expect.poll(async () => (await tabs(page))[0]?.tabs.map((t) => t.title)).toEqual(['b.md', 'untitled'])
  await expect(page.getByTestId('path')).toHaveText('untitled')

  await app.close()
})
