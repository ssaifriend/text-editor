import { test, expect } from '@playwright/test'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

  await page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await expect(page.getByTestId('status')).toContainText('saved')

  expect(readFileSync(target, 'utf8')).toBe(`// edited\n${readFileSync(fixture, 'utf8')}`)

  await app.close()
})

test('save trims trailing whitespace and adds a final newline when enabled', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-file-'))
  const target = join(dir, 'trim.txt')
  writeFileSync(target, 'keep\nend')
  const userData = mkdtempSync(join(tmpdir(), 'moru-e2e-'))
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ files: { trimTrailingWhitespace: true, insertFinalNewline: true } }))
  const { app, page } = await launchApp({ MORU_TEST_OPEN: target }, { userData })

  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(8))
  await page.keyboard.type(' x   ')
  await page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await expect(page.getByTestId('status')).toContainText('saved')

  expect(readFileSync(target, 'utf8')).toBe('keep\nend x\n')
  expect(await page.evaluate(() => window.__moruTest!.doc())).toBe('keep\nend x\n')
  expect(await page.evaluate(() => window.__moruTest!.dirty())).toBe(false)
  await app.close()
})
