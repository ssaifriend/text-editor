import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from './launch'

test('main writes a log file under userData/logs', async () => {
  const { app } = await launchApp()
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))

  const logPath = join(userData, 'logs', 'main.log')
  await expect.poll(() => existsSync(logPath) && readFileSync(logPath, 'utf8').includes('app ready')).toBe(true)

  await app.close()
})
