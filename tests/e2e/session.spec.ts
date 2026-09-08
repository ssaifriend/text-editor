import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('layout, tabs, selection, undo history and dirty text survive a graceful quit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-sess-'))
  const a = join(dir, 'a.ts')
  const b = join(dir, 'b.md')
  writeFileSync(a, 'const a = 1\n')
  writeFileSync(b, '# b\n')

  const first = await launchApp({ MORU_TEST_OPEN: a })
  await first.page.evaluate((p) => window.__moruTest!.openPath(p), b)
  await first.page.evaluate(() => window.__moruTest!.runCommand('view.splitRight'))
  await first.page.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await first.page.evaluate(() => window.__moruTest!.runCommand('view.focusPane', 1))
  await first.page.evaluate(() => window.__moruTest!.runCommand('tab.select', 1))
  await first.page.evaluate(() => window.__moruTest!.focus())
  await first.page.evaluate(() => window.__moruTest!.setCursor(0))
  await first.page.keyboard.type('// edited ')
  await first.page.evaluate(() => window.__moruTest!.setCursor(3))
  await first.page.waitForTimeout(1200)
  await first.app.close()

  const second = await launchApp({}, { userData: first.userData })
  const tabs = await second.page.evaluate(() => window.__moruTest!.tabs())
  expect(tabs.length).toBe(2)
  expect(tabs[0]?.tabs.map((t) => t.title)).toEqual(['a.ts', 'b.md'])
  expect(tabs[1]?.tabs.map((t) => t.title)).toEqual(['Terminal 1'])
  expect(tabs[0]?.active).toBe(true)

  await expect.poll(() => second.page.evaluate(() => window.__moruTest!.doc())).toBe('// edited const a = 1\n')
  expect(await second.page.evaluate(() => window.__moruTest!.dirty())).toBe(true)
  expect(await second.page.evaluate(() => window.__moruTest!.selections()[0]?.from)).toBe(3)

  await second.page.evaluate(() => window.__moruTest!.focus())
  await second.page.keyboard.press(`${mod}+z`)
  await expect.poll(() => second.page.evaluate(() => window.__moruTest!.doc())).toBe('const a = 1\n')
  expect(readFileSync(a, 'utf8')).toBe('const a = 1\n')
  await second.app.close()
})

test('a clean buffer whose file changed while closed loads the disk version without history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moru-sess-'))
  const a = join(dir, 'a.ts')
  writeFileSync(a, 'v1\n')
  const first = await launchApp({ MORU_TEST_OPEN: a })
  await first.page.evaluate(() => window.__moruTest!.focus())
  await first.page.keyboard.type('x')
  await first.page.evaluate(() => window.__moruTest!.runCommand('file.save'))
  await first.page.waitForTimeout(1200)
  await first.app.close()

  writeFileSync(a, 'changed outside\n')
  const second = await launchApp({}, { userData: first.userData })
  await expect.poll(() => second.page.evaluate(() => window.__moruTest!.doc())).toBe('changed outside\n')
  await second.page.evaluate(() => window.__moruTest!.focus())
  await second.page.keyboard.press(`${mod}+z`)
  await second.page.waitForTimeout(200)
  expect(await second.page.evaluate(() => window.__moruTest!.doc())).toBe('changed outside\n')
  await second.app.close()
})

test('two windows come back as two windows after SIGKILL', async () => {
  const first = await launchApp({})
  const w2 = first.app.waitForEvent('window')
  await first.page.evaluate(() => window.__moruTest!.runCommand('window.new'))
  const page2 = await w2
  await page2.waitForFunction(() => window.__moruTest?.ready() === true)
  await page2.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await first.page.waitForTimeout(1200)
  first.app.process().kill('SIGKILL')
  await new Promise((r) => setTimeout(r, 500))

  const second = await launchApp({}, { userData: first.userData })
  await expect.poll(() => second.app.windows().length).toBe(2)
  await second.app.close()
})
