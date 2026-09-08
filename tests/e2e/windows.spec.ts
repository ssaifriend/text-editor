import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')

test('window.new opens a second window whose terminals are isolated', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  const second = app.waitForEvent('window')
  await page.evaluate(() => window.__moruTest!.runCommand('window.new'))
  const page2 = await second
  await page2.waitForFunction(() => window.__moruTest?.ready() === true)

  expect(app.windows().length).toBe(2)
  expect(await page2.evaluate(() => window.__moruTest!.tabs()[0]?.tabs.length)).toBe(1)

  await page2.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await page2.evaluate(() => window.__moruTest!.terminalFocus())
  await page2.keyboard.type('echo second-window\n')
  await expect.poll(() => page2.evaluate(() => window.__moruTest!.terminalText()), { timeout: 10_000 }).toContain('second-window')

  expect(await page.evaluate(() => window.__moruTest!.terminals().length)).toBe(0)
  const [id1, id2] = await Promise.all([
    page.evaluate(() => window.__moruTest!.windowId()),
    page2.evaluate(() => window.__moruTest!.windowId()),
  ])
  expect(id1).not.toBe(id2)

  await page2.close()
  await expect.poll(() => app.windows().length).toBe(1)
  await app.close()
})
