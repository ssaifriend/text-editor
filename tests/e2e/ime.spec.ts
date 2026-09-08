import { test, expect, type Page, type CDPSession } from '@playwright/test'
import { resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

const doc = (page: Page): Promise<string> => page.evaluate(() => window.__moruTest!.doc())
const composing = (page: Page): Promise<boolean> => page.evaluate(() => window.__moruTest!.composing())
const selections = (page: Page) => page.evaluate(() => window.__moruTest!.selections())

const compose = (cdp: CDPSession, text: string) =>
  cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })

const commit = (cdp: CDPSession, text: string) => cdp.send('Input.insertText', { text })

const placeCursorInsideQuotes = async (page: Page): Promise<void> => {
  const text = await doc(page)
  const inside = text.indexOf('""') + 1
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate((pos) => window.__moruTest!.setCursor(pos), inside)
}

const openFixture = async () => {
  const launched = await launchApp({ MORU_TEST_OPEN: fixture })
  await expect.poll(() => doc(launched.page)).toContain('const greeting = "";')
  const cdp = await launched.page.context().newCDPSession(launched.page)
  return { ...launched, cdp }
}

test.describe('Korean IME composition in CodeMirror with syntax highlighting on', () => {
  test('composes 한 step by step inside a string literal and commits', async () => {
    const { app, page, cdp } = await openFixture()
    await placeCursorInsideQuotes(page)

    await compose(cdp, 'ㅎ')
    await expect.poll(() => doc(page)).toContain('"ㅎ"')
    await expect.poll(() => composing(page)).toBe(true)

    await compose(cdp, '하')
    await expect.poll(() => doc(page)).toContain('"하"')

    await compose(cdp, '한')
    await expect.poll(() => doc(page)).toContain('"한"')

    await commit(cdp, '한')
    await expect.poll(() => doc(page)).toContain('"한"')
    await expect.poll(() => composing(page)).toBe(false)

    await compose(cdp, 'ㄱ')
    await compose(cdp, '그')
    await compose(cdp, '글')
    await commit(cdp, '글')
    await expect.poll(() => doc(page)).toContain('"한글"')

    const text = await doc(page)
    expect(text.match(/한글/g)?.length).toBe(1)
    expect(text).not.toContain('ㅎ')
    expect(text).not.toContain('ㄱ')

    await app.close()
  })

  test('cancelling a composition removes the preedit text', async () => {
    const { app, page, cdp } = await openFixture()
    await placeCursorInsideQuotes(page)

    await compose(cdp, 'ㅎ')
    await expect.poll(() => doc(page)).toContain('"ㅎ"')

    await compose(cdp, '')
    await expect.poll(() => doc(page)).toContain('const greeting = "";')
    await expect.poll(() => doc(page)).not.toContain('ㅎ')

    await app.close()
  })

  test('undo after a committed composition removes the whole syllable', async () => {
    const { app, page, cdp } = await openFixture()
    await placeCursorInsideQuotes(page)

    await compose(cdp, 'ㅎ')
    await compose(cdp, '하')
    await compose(cdp, '한')
    await commit(cdp, '한')
    await expect.poll(() => doc(page)).toContain('"한"')

    await page.keyboard.press(`${mod}+z`)
    await expect.poll(() => doc(page)).toContain('const greeting = "";')

    await app.close()
  })

  test('composition is mirrored to every cursor when multiple cursors are active', async () => {
    const { app, page, cdp } = await openFixture()

    const text = await doc(page)
    const firstFoo = text.indexOf('foo')
    await page.evaluate(() => window.__moruTest!.focus())
    await page.evaluate((pos) => window.__moruTest!.setCursor(pos), firstFoo)

    await page.keyboard.press(`${mod}+d`)
    await page.keyboard.press(`${mod}+d`)
    await expect.poll(() => selections(page).then((s) => s.length)).toBe(2)

    await compose(cdp, 'ㅎ')
    await compose(cdp, '한')
    await commit(cdp, '한')

    await expect.poll(() => doc(page)).toContain('const 한 = 1;')
    await expect.poll(() => doc(page)).toContain('const bar = 한 + foo;')

    await app.close()
  })

  test('[info] composition with highlightWhitespace enabled', async () => {
    const { app, page, cdp } = await openFixture()
    await page.evaluate(() => window.__moruTest!.setWhitespace(true))
    await placeCursorInsideQuotes(page)

    await compose(cdp, 'ㅎ')
    await compose(cdp, '하')
    await compose(cdp, '한')
    await commit(cdp, '한')

    await expect.poll(() => doc(page)).toContain('"한"')
    expect((await doc(page)).match(/한/g)?.length).toBe(1)

    await app.close()
  })
})
