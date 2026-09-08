import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')

test('menu items dispatch commands to the renderer', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs().length)).toBe(1)

  const clicked = await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('view.splitRight')
    item?.click()
    return item !== null && item !== undefined
  })
  expect(clicked).toBe(true)

  await expect.poll(() => page.evaluate(() => window.__moruTest!.tabs().length)).toBe(2)
  await app.close()
})
