import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { launchApp } from './launch'

const ci = Boolean(process.env['CI'])
const budget = (local: number) => (ci ? local * 2 : local)
const record = (key: string, value: unknown) => {
  mkdirSync('test-results', { recursive: true })
  writeFileSync(`test-results/perf-${key}.json`, JSON.stringify(value, null, 2))
}

const tsLines = (n: number): string =>
  Array.from({ length: n }, (_, i) => `export const value${i} = ${i} // 한글 주석 ${i}\nfunction fn${i}(a: number, b: string): string { return \`\${a}-\${b}\` }`).join('\n') + '\n'

const project = (files: number, linesEach: number): { root: string; paths: string[] } => {
  const root = mkdtempSync(join(tmpdir(), 'moru-perf-'))
  const paths = Array.from({ length: files }, (_, i) => {
    const path = join(root, `file${i}.ts`)
    writeFileSync(path, tsLines(linesEach))
    return path
  })
  return { root, paths }
}

const p95 = (xs: readonly number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0
}

test('startup: first paint under budget', async () => {
  const { app } = await launchApp()
  await expect.poll(() => app.evaluate(() => globalThis.__moruMetrics?.firstPaintMs ?? null)).not.toBeNull()
  const startup = await app.evaluate(() => globalThis.__moruMetrics!)
  record('startup', startup)
  expect(startup.firstPaintMs).toBeLessThan(budget(1000))
  await app.close()
})

test('memory: main + renderers with 10 files open and no terminal', async () => {
  const { root, paths } = project(10, 200)
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root, MORU_TEST_OPEN: paths.join(delimiter) })
  await expect.poll(async () => (await page.evaluate(() => window.__moruTest!.tabs()))[0]?.tabs.length).toBe(10)
  await page.waitForTimeout(1500)

  const main = await app.evaluate(() => process.getProcessMemoryInfo().then((m) => ({ privateMb: Math.round(m.private / 1024), sharedMb: Math.round(m.shared / 1024) })))
  const renderer = await page.evaluate(() => window.moru.memory())
  const workingSets = await app.evaluate(({ app: electronApp }) =>
    electronApp.getAppMetrics().map((p) => ({ type: p.type, workingSetMb: Math.round(p.memory.workingSetSize / 1024) })),
  )
  const privateMb = main.privateMb + renderer.privateMb
  record('memory', { main, renderer, mainPlusRenderersPrivateMb: privateMb, workingSets })
  expect(privateMb).toBeLessThan(budget(300))
  await app.close()
})

test('typing latency p95 on a 5k-line highlighted file', async () => {
  const { root, paths } = project(1, 2500)
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root, MORU_TEST_OPEN: paths[0]! })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setCursor(0))
  await page.waitForTimeout(500)

  await page.evaluate(() => window.__moruTest!.latencyProbe('start'))
  await page.keyboard.type('const typed = "한글 latency probe 0123456789";', { delay: 40 })
  await page.waitForTimeout(200)
  const samples = await page.evaluate(() => window.__moruTest!.latencyProbe('stop'))
  const value = p95(samples)
  record('typing', { samples: samples.length, p95Ms: Number(value.toFixed(2)), maxMs: Number(Math.max(...samples).toFixed(2)), asserted: !ci })
  expect(samples.length).toBeGreaterThan(20)
  // GitHub runners have no GPU and throttle hidden-window frames (macOS 36 ms, Windows 800+ ms), so the
  // frame-based latency budget is recorded there but only asserted on a real machine.
  if (ci) test.info().annotations.push({ type: 'informational', description: `typing p95 ${value.toFixed(1)} ms (not asserted on CI)` })
  else expect(value).toBeLessThan(16)
  await app.close()
})

test('opening a 50k-line file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'moru-perf-'))
  const path = join(root, 'big.ts')
  writeFileSync(path, tsLines(25_000))
  const { app, page } = await launchApp({ MORU_TEST_ROOT: root })
  const ms = await page.evaluate((p) => window.__moruTest!.timeOpen(p), path)
  const lines = await page.evaluate(() => window.__moruTest!.doc().split('\n').length)
  record('openLarge', { lines, ms: Number(ms.toFixed(1)) })
  expect(lines).toBeGreaterThanOrEqual(50_000)
  expect(ms).toBeLessThan(budget(500))
  await app.close()
})
