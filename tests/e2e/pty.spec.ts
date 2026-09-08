import { test, expect } from '@playwright/test'
import { launchApp } from './launch'

test('node-pty spawns the shell inside the Electron main process', async () => {
  const { app } = await launchApp()

  const result = await app.evaluate(() => globalThis.__moruProbePty!())

  expect(result.output).toContain('moru-pty-ok')
  expect(result.exitCode).toBe(0)

  await app.close()
})
