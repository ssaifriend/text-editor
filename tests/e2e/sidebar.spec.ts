import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'moru-proj-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1\n')
  writeFileSync(join(root, 'README.md'), '# hi\n')
  return root
}

test('sidebar lists the project root, expands directories, opens files', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root })
  await expect(page.getByTestId('sidebar')).toBeVisible()
  const names = page.getByTestId('tree-row').locator('.tree-name')
  await expect(names).toHaveText(['src', 'README.md'])

  await page.getByTestId('tree-row').filter({ hasText: 'src' }).click()
  await expect(names).toHaveText(['src', 'index.ts', 'README.md'])

  await page.getByTestId('tree-row').filter({ hasText: 'index.ts' }).click()
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toBe('export const x = 1\n')
  await expect(page.getByTestId('path')).toHaveText(join('src', 'index.ts'))

  await page.evaluate(() => window.__moruTest!.runCommand('sidebar.toggle'))
  await expect(page.getByTestId('sidebar')).toBeHidden()
  await app.close()
})

test('new file, rename and delete refresh the tree and keep buffers consistent', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root })

  await page.evaluate((r) => window.__moruTest!.runCommand('sidebar.newFile', { dir: r, name: 'notes.md' }), root)
  await expect(page.getByTestId('tree-row').filter({ hasText: 'notes.md' })).toHaveCount(1)
  expect(existsSync(join(root, 'notes.md'))).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'notes.md'))

  await page.evaluate((r) => window.__moruTest!.runCommand('sidebar.rename', { path: r, name: 'todo.md' }), join(root, 'notes.md'))
  await expect(page.getByTestId('tree-row').filter({ hasText: 'todo.md' })).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.path())).toBe(join(root, 'todo.md'))

  await page.evaluate((r) => window.__moruTest!.runCommand('sidebar.delete', { path: r }), join(root, 'README.md'))
  await expect(page.getByTestId('tree-row').filter({ hasText: 'README.md' })).toHaveCount(0)
  expect(existsSync(join(root, 'README.md'))).toBe(false)
  await app.close()
})

test('terminal cwd is the project root', async () => {
  test.skip(process.platform === 'win32', 'pwd is POSIX')
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root })
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await page.evaluate(() => window.__moruTest!.terminalFocus())
  await page.keyboard.type('pwd\n')
  await expect
    .poll(() => page.evaluate(() => window.__moruTest!.terminalText()), { timeout: 10_000 })
    .toContain(root.replace('/private', ''))
  await app.close()
})
