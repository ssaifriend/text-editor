import { test, expect, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const doc = (page: Page) => page.evaluate(() => window.__moruTest!.doc())
const run = (page: Page, id: string) => page.evaluate((c) => window.__moruTest!.runCommand(c), id)

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'moru-md-'))
  mkdirSync(join(root, 'img'))
  writeFileSync(join(root, 'img', 'dot.png'), pixel)
  const body = Array.from({ length: 60 }, (_, i) => (i === 0 ? '# 제목' : i === 30 ? '## 중간' : `문단 ${i} **굵게**`)).join('\n\n')
  writeFileSync(join(root, 'README.md'), `${body}\n\n![dot](./img/dot.png)\n\n<script>alert(1)</script>\n`)
  writeFileSync(join(root, 'edit.md'), 'hello world\n- [ ] task\n|a|b|\n|--|--|\n|한글|1|\n')
  return root
}

test('markdown editing commands: wrap, checkbox, table, heading, link on paste', async () => {
  const root = project()
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root, MORU_TEST_OPEN: join(root, 'edit.md') })
  await page.evaluate(() => window.__moruTest!.focus())

  await page.evaluate(() => window.__moruTest!.setSelection(6, 11))
  await page.keyboard.press(`${mod}+b`)
  await expect.poll(() => doc(page)).toContain('hello **world**')

  await page.evaluate(() => window.__moruTest!.setCursor(20))
  await run(page, 'markdown.toggleCheckbox')
  await expect.poll(() => doc(page)).toContain('- [x] task')

  await page.evaluate(() => window.__moruTest!.setCursor(32))
  await run(page, 'markdown.alignTable')
  await expect.poll(() => doc(page)).toContain('| 한글 | 1   |')

  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await run(page, 'markdown.headingUp')
  await expect.poll(() => doc(page)).toMatch(/^# hello/)

  await page.evaluate(() => window.__moruTest!.setSelection(2, 7))
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData('text/plain', 'https://example.com/x')
    document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await expect.poll(() => doc(page)).toContain('[hello](https://example.com/x)')
  await app.close()
})

test('preview renders sanitized html with local images, updates live, syncs scroll and exports html', async () => {
  const root = project()
  const out = join(root, 'out.html')
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root, MORU_TEST_OPEN: join(root, 'README.md'), MORU_TEST_SAVE_PATH: out })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.keyboard.press(`${mod}+Shift+v`)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.previewTabs())).toBe(1)
  await expect(page.getByTestId('preview-body').locator('h1')).toHaveText('제목')

  const html = await page.evaluate(() => window.__moruTest!.previewHtml())
  expect(html).not.toContain('<script')
  expect(html).toContain('app-file://local/')
  await expect
    .poll(() => page.evaluate(() => (document.querySelector('[data-testid="preview-body"] img') as HTMLImageElement | null)?.naturalWidth ?? 0))
    .toBe(1)

  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(4))
  await page.keyboard.type(' 새')
  await expect(page.getByTestId('preview-body').locator('h1')).toHaveText('제목 새')

  await page.evaluate(() => window.__moruTest!.gotoLineTop(61))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.previewScrollLine())).toBeGreaterThanOrEqual(55)

  await run(page, 'markdown.exportHtml')
  await expect.poll(() => (existsSync(out) ? readFileSync(out, 'utf8') : '')).toContain('<h1')
  expect(readFileSync(out, 'utf8')).not.toContain('<script')

  await page.keyboard.press(`${mod}+Shift+v`)
  await expect.poll(() => page.evaluate(() => window.__moruTest!.previewTabs())).toBe(0)
  await app.close()
})
