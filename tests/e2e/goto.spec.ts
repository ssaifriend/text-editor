import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const tabs = (page: Page) => page.evaluate(() => window.__moruTest!.tabs())
const items = (page: Page) => page.evaluate(() => window.__moruTest!.paletteItems())

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'moru-goto-'))
  mkdirSync(join(root, 'src', 'app'), { recursive: true })
  writeFileSync(join(root, 'src', 'app', 'workspace.ts'), 'export const alpha = 1\nfunction beta() {}\nclass Gamma {}\n')
  writeFileSync(join(root, 'src', 'notes.md'), '# Notes\n\n## Later\n')
  writeFileSync(join(root, 'README.md'), Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') + '\n')
  return root
}

test('cmd+p fuzzy-finds files, previews while arrowing, commits on enter, escape restores', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root, MORU_TEST_OPEN: join(root, 'README.md') })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+p`)
  await expect(page.getByTestId('palette')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__moruTest!.paletteMode())).toBe('goto')

  await page.keyboard.type('wksp')
  await expect.poll(() => items(page)).toContain('src/app/workspace.ts')
  await expect.poll(async () => (await tabs(page))[0]?.tabs.map((t) => t.title)).toEqual(['README.md', 'workspace.ts'])

  await page.keyboard.press('Escape')
  await expect.poll(async () => (await tabs(page))[0]?.tabs.map((t) => t.title)).toEqual(['README.md'])
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'README.md'))

  await page.keyboard.press(`${mod}+p`)
  await page.keyboard.type('notes')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'src', 'notes.md'))
  await expect(page.getByTestId('palette')).toBeHidden()
  await app.close()
})

test('file@symbol and file:line jump after opening', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root })
  await page.keyboard.press(`${mod}+p`)
  await page.keyboard.type('wksp@gam')
  await expect.poll(() => items(page)).toContain('Gamma')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'src', 'app', 'workspace.ts'))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.selections()[0]?.from)).toBe(48)

  await page.keyboard.press(`${mod}+p`)
  await page.keyboard.type('readme:30')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'README.md'))
  await expect(page.getByTestId('pos')).toHaveText('Ln 30, Col 1')
  await app.close()
})

test('@symbol, :line and #word on the active buffer', async () => {
  const root = project()
  const file = join(root, 'src', 'app', 'workspace.ts')
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root, MORU_TEST_OPEN: file })
  await page.evaluate(() => window.__moruTest!.focus())

  await page.keyboard.press(`${mod}+r`)
  await expect.poll(() => items(page)).toEqual(['alpha', 'beta', 'Gamma'])
  await page.keyboard.type('bet')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.selections()[0]?.from)).toBe(32)

  await page.keyboard.press('Control+g')
  await page.keyboard.type('3')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('pos')).toHaveText('Ln 3, Col 1')

  await page.keyboard.press(`${mod}+p`)
  await page.keyboard.type('#alp')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__moruTest!.selections()[0]?.from)).toBe(13)
  await app.close()
})

test('empty query lists recent files first', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root })
  await page.evaluate((p) => window.__moruTest!.openPath(p), join(root, 'src', 'notes.md'))
  await page.evaluate((p) => window.__moruTest!.openPath(p), join(root, 'README.md'))
  await page.keyboard.press(`${mod}+p`)
  await expect.poll(() => items(page).then((xs) => xs.slice(0, 2))).toEqual(['README.md', 'src/notes.md'])
  await page.keyboard.press('Escape')
  await app.close()
})
