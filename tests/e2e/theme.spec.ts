import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')

test('theme setting switches css variables and the CodeMirror theme', async () => {
  const { app, page, userData } = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset['theme'])).toBe('moru-dark')
  const darkBg = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-editor')!).backgroundColor)

  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ theme: 'moru-light' }))
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['theme']), { timeout: 10_000 })
    .toBe('moru-light')
  const lightBg = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-editor')!).backgroundColor)

  expect(lightBg).not.toBe(darkBg)
  expect(lightBg).toBe('rgb(251, 251, 251)')
  expect(darkBg).toBe('rgb(30, 34, 39)')
  await app.close()
})

test('a user theme file in userData/themes becomes selectable and hot-reloads', async () => {
  const { app, page, userData } = await launchApp({ MORU_TEST_OPEN: fixture })
  const palette = Object.fromEntries(
    ['bg', 'fg', 'bar', 'border', 'selection', 'cursor', 'activeLine', 'gutter', 'keyword', 'string', 'comment', 'number', 'fn', 'type', 'variable', 'operator', 'heading', 'link'].map((k) => [k, '#336699']),
  )
  mkdirSync(join(userData, 'themes'), { recursive: true })
  writeFileSync(join(userData, 'themes', 'mine.json'), JSON.stringify({ id: 'mine', dark: true, palette: { ...palette, bg: '#102030' } }))
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ theme: 'mine' }))

  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.cm-editor')!).backgroundColor), { timeout: 10_000 })
    .toBe('rgb(16, 32, 48)')
  expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe('mine')

  writeFileSync(join(userData, 'themes', 'mine.json'), JSON.stringify({ id: 'mine', dark: true, palette: { ...palette, bg: '#405060' } }))
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.cm-editor')!).backgroundColor), { timeout: 10_000 })
    .toBe('rgb(64, 80, 96)')
  await app.close()
})
