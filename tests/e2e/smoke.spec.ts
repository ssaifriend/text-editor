import { test, expect } from '@playwright/test'
import { launchApp } from './launch'

test('window opens with the app shell', async () => {
  const { app, page } = await launchApp()

  await expect(page).toHaveTitle('moru')
  await expect(page.locator('.statusbar')).toBeVisible()
  await expect(page.locator('.pane')).toHaveCount(1)

  await app.close()
})
