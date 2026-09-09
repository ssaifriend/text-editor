import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from './launch'

test('quitting with a live terminal and a second window logs no uncaught exception', async () => {
  const { app, page, userData } = await launchApp()
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.terminals().filter((t) => t.alive).length)).toBe(1)
  await page.evaluate(() => window.__moruTest!.runCommand('window.new'))
  await expect.poll(() => app.windows().length).toBe(2)
  await page.waitForTimeout(300)
  await app.close()

  const log = join(userData, 'logs', 'main.log')
  const text = existsSync(log) ? readFileSync(log, 'utf8') : ''
  expect(text).not.toContain('uncaught exception')
  expect(text).not.toContain('Object has been destroyed')
})
