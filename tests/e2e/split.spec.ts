import { test, expect, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')
const panes = (page: Page) => page.evaluate(() => window.__moruTest!.tabs())

test('split right creates an empty active pane; opening a file lands there; single pane merges back', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(async () => (await panes(page)).length).toBe(1)

  await page.evaluate(() => window.__moruTest!.runCommand('view.splitRight'))
  await expect.poll(async () => (await panes(page)).length).toBe(2)
  const after = await panes(page)
  expect(after[1]?.active).toBe(true)
  expect(after[1]?.tabs).toEqual([])
  await expect(page.locator('.pane')).toHaveCount(2)

  await page.evaluate(() => window.__moruTest!.runCommand('file.new'))
  await expect.poll(async () => (await panes(page))[1]?.tabs.map((t) => t.title)).toEqual(['untitled'])

  await page.evaluate(() => window.__moruTest!.runCommand('view.focusPane', 1))
  await expect.poll(async () => (await panes(page))[0]?.active).toBe(true)

  await page.evaluate(() => window.__moruTest!.runCommand('view.singlePane'))
  await expect.poll(async () => (await panes(page)).length).toBe(1)
  expect((await panes(page))[0]?.tabs.map((t) => t.title)).toEqual(['ime.ts', 'untitled'])

  await app.close()
})

test('split down nests a column split and closing the pane collapses it', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })

  await page.evaluate(() => window.__moruTest!.runCommand('view.splitRight'))
  await page.evaluate(() => window.__moruTest!.runCommand('view.splitDown'))
  await expect.poll(async () => (await panes(page)).length).toBe(3)
  await expect(page.locator('.split.col')).toHaveCount(1)

  await page.evaluate(() => window.__moruTest!.runCommand('view.closePane'))
  await expect.poll(async () => (await panes(page)).length).toBe(2)
  await page.evaluate(() => window.__moruTest!.runCommand('view.closePane'))
  await expect.poll(async () => (await panes(page)).length).toBe(1)
  await page.evaluate(() => window.__moruTest!.runCommand('view.closePane'))
  expect((await panes(page)).length).toBe(1)

  await app.close()
})
