import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export type Launched = { readonly app: ElectronApplication; readonly page: Page }

export const launchApp = async (env: Record<string, string> = {}): Promise<Launched> => {
  const userData = mkdtempSync(join(tmpdir(), 'moru-e2e-'))

  const app = await electron.launch({
    args: [resolve('out/main/index.js')],
    env: { ...process.env, MORU_TEST: '1', MORU_USER_DATA: userData, ...env },
  })

  const page = await app.firstWindow()
  await page.waitForSelector('#root')

  return { app, page }
}
