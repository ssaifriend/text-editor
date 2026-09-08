import { test, expect, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const text = (page: Page) => page.evaluate(() => window.__moruTest!.terminalText())
const tabs = (page: Page) => page.evaluate(() => window.__moruTest!.tabs())

test.skip(process.platform === 'win32', 'shell commands below are POSIX')

test('terminal.new opens a shell tab that echoes output and keeps its buffer across tab switches', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await expect.poll(async () => (await tabs(page))[0]?.tabs.map((t) => t.title)).toEqual(['ime.ts', 'Terminal 1'])
  await expect(page.locator('.xterm')).toHaveCount(1)

  await page.evaluate(() => window.__moruTest!.terminalFocus())
  await page.keyboard.type('echo moru-term-ok\n')
  await expect.poll(() => text(page), { timeout: 10_000 }).toContain('moru-term-ok')

  await page.evaluate(() => window.__moruTest!.runCommand('tab.select', 1))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toContain('const foo')
  await page.evaluate(() => window.__moruTest!.runCommand('tab.select', 2))
  await expect.poll(() => text(page)).toContain('moru-term-ok')

  await app.close()
})

test('reserved keys reach the app while other keys reach the shell', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await page.evaluate(() => window.__moruTest!.terminalFocus())

  await page.keyboard.press(`${mod}+/`)
  await page.keyboard.type('x\n')
  await expect.poll(() => text(page), { timeout: 10_000 }).toContain('x')
  await page.evaluate(() => window.__moruTest!.runCommand('tab.select', 1))
  expect(await page.evaluate(() => window.__moruTest!.doc())).not.toContain('//')

  await page.evaluate(() => window.__moruTest!.runCommand('tab.select', 2))
  await page.evaluate(() => window.__moruTest!.terminalFocus())
  await page.keyboard.press(`${mod}+Shift+p`)
  await expect(page.getByTestId('palette')).toBeVisible()
  await page.keyboard.press('Escape')
  await app.close()
})

test('send selection and @path to the terminal', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setSelection(6, 14))
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.sendSelection'))
  await expect.poll(async () => (await tabs(page))[0]?.tabs.length).toBe(2)
  await expect.poll(() => text(page), { timeout: 10_000 }).toContain('greeting')

  await page.evaluate(() => window.__moruTest!.runCommand('tab.select', 1))
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.sendAtPath'))
  await expect.poll(() => text(page), { timeout: 10_000 }).toContain('@')
  await expect.poll(() => text(page)).toContain('ime.ts')
  await app.close()
})

test('exited shell shows an overlay and can be restarted', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await page.evaluate(() => window.__moruTest!.terminalFocus())
  await page.keyboard.type('exit 3\n')
  await expect(page.getByTestId('terminal-exit')).toContainText('exited 3', { timeout: 10_000 })
  await expect.poll(async () => (await page.evaluate(() => window.__moruTest!.terminals()))[0]?.alive).toBe(false)

  await page.getByTestId('terminal-restart').click()
  await expect(page.getByTestId('terminal-exit')).toHaveCount(0)
  await page.evaluate(() => window.__moruTest!.terminalFocus())
  await page.keyboard.type('echo back-again\n')
  await expect.poll(() => text(page), { timeout: 10_000 }).toContain('back-again')
  await app.close()
})

test('closing a live terminal asks for confirmation', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture, MORU_TEST_CONFIRM: 'cancel' })
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await page.evaluate(() => window.__moruTest!.runCommand('tab.close'))
  await page.waitForTimeout(200)
  expect((await tabs(page))[0]?.tabs.length).toBe(2)
  await app.close()
})

test('[info] Korean composition inside the terminal reaches the shell', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await page.evaluate(() => window.__moruTest!.terminalFocus())
  await page.keyboard.type('cat\n')
  await page.waitForTimeout(300)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.insertText', { text: '한' })
  await page.keyboard.press('Enter')
  await expect.poll(() => text(page), { timeout: 10_000 }).toMatch(/한\s*\n\s*한/)
  await app.close()
})
