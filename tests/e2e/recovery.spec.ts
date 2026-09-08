import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const killHard = async (app: import('@playwright/test').ElectronApplication) => {
  app.process().kill('SIGKILL')
  await new Promise((r) => setTimeout(r, 500))
}

test('unsaved edits and untitled buffers survive SIGKILL', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-recovery-'))
  const path = join(dir, 'a.txt')
  writeFileSync(path, 'disk\n')

  const first = await launchApp({ MORU_TEST_OPEN: path })
  await first.page.evaluate(() => window.__moruTest!.focus())
  await first.page.evaluate(() => window.__moruTest!.setCursor(0))
  await first.page.keyboard.type('unsaved ')
  await first.page.evaluate(() => window.__moruTest!.runCommand('file.new'))
  await first.page.evaluate(() => window.__moruTest!.focus())
  await first.page.keyboard.type('scratch 한글')
  await first.page.waitForTimeout(1500)

  await killHard(first.app)
  expect(readFileSync(path, 'utf8')).toBe('disk\n')

  const second = await launchApp({}, { userData: first.userData })
  await expect
    .poll(async () => (await second.page.evaluate(() => window.__moruTest!.tabs()))[0]?.tabs.map((t) => t.title))
    .toEqual(['a.txt', 'untitled'])

  await second.page.evaluate(() => window.__moruTest!.runCommand('tab.select', 1))
  await expect.poll(() => second.page.evaluate(() => window.__moruTest!.doc())).toBe('unsaved disk\n')
  expect(await second.page.evaluate(() => window.__moruTest!.dirty())).toBe(true)

  await second.page.evaluate(() => window.__moruTest!.runCommand('tab.select', 2))
  await expect.poll(() => second.page.evaluate(() => window.__moruTest!.doc())).toBe('scratch 한글')

  await second.app.close()
})

test('a restored file buffer is not opened twice when it is also a startup path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-recovery-'))
  const path = join(dir, 'a.txt')
  writeFileSync(path, 'disk\n')

  const first = await launchApp({ MORU_TEST_OPEN: path })
  await first.page.evaluate(() => window.__moruTest!.focus())
  await first.page.keyboard.type('x')
  await first.page.waitForTimeout(1500)
  await killHard(first.app)

  const second = await launchApp({ MORU_TEST_OPEN: path }, { userData: first.userData })
  await expect.poll(async () => (await second.page.evaluate(() => window.__moruTest!.tabs()))[0]?.tabs.length).toBe(1)
  await expect.poll(() => second.page.evaluate(() => window.__moruTest!.doc())).toContain('x')
  await second.app.close()
})
