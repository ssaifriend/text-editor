import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { launchApp } from './launch'

test('records startup marks and resident memory baseline', async () => {
  const { app } = await launchApp()

  await expect.poll(() => app.evaluate(() => globalThis.__moruMetrics?.firstPaintMs ?? null)).not.toBeNull()

  const snapshot = await app.evaluate(({ app: electronApp }) => ({
    startup: globalThis.__moruMetrics!,
    processes: electronApp.getAppMetrics().map((p) => ({ type: p.type, rssKb: p.memory.workingSetSize })),
  }))

  const rssMb = Math.round(snapshot.processes.reduce((sum, p) => sum + p.rssKb, 0) / 1024)

  mkdirSync('test-results', { recursive: true })
  writeFileSync('test-results/m0-metrics.json', JSON.stringify({ ...snapshot, rssMb }, null, 2))

  expect(snapshot.startup.firstPaintMs).toBeLessThan(3000)
  expect(rssMb).toBeLessThan(600)

  await app.close()
})
