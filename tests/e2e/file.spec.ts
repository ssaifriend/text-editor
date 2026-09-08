import { test, expect } from '@playwright/test'
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')

test('opens the bootstrap file and saves edits back to disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-file-'))
  const target = join(dir, 'copy.ts')
  copyFileSync(fixture, target)

  const { app, page } = await launchApp({ MORU_TEST_OPEN: target })

  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toContain('const greeting = "";')
  await expect(page.getByTestId('path')).toHaveText(target)
  await expect(page.getByTestId('pos')).toHaveText('Ln 1, Col 1')

  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.keyboard.type('// edited\n')
  await expect(page.getByTestId('pos')).toHaveText('Ln 2, Col 1')

  await page.getByTestId('save').click()
  await expect(page.getByTestId('status')).toContainText('saved')

  expect(readFileSync(target, 'utf8')).toBe(`// edited\n${readFileSync(fixture, 'utf8')}`)

  await app.close()
})
