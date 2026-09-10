import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { createMatcher } from '../../../src/main/index/service'

describe('index matcher', () => {
  it('ranks basename matches and returns positions', () => {
    const m = createMatcher(['src/app/workspace.ts', 'src/ui/tabs/TabStrip.tsx', 'docs/plan.md'], '/root')
    const items = m.query('wksp', 10)
    expect(items[0]?.rel).toBe('src/app/workspace.ts')
    expect(items[0]?.path).toBe(join('/root', 'src', 'app', 'workspace.ts'))
    expect(items[0]?.positions.length).toBe(4)
    expect(m.query('', 2).map((i) => i.rel)).toEqual(['src/app/workspace.ts', 'src/ui/tabs/TabStrip.tsx'])
  })

  it('answers a 50k-path query under budget', () => {
    const paths = Array.from({ length: 50_000 }, (_, i) => `pkg${i % 97}/module${Math.floor(i / 97)}/file${i}.ts`)
    const m = createMatcher(paths, '/root')
    // best of 5: the unit suite runs files in parallel workers, so a single sample is noisy
    const runs = Array.from({ length: 5 }, () => {
      const started = performance.now()
      const found = m.query('mod12fil', 50)
      return { ms: performance.now() - started, found }
    })
    const items = runs[0]!.found
    const elapsed = Math.min(...runs.map((r) => r.ms))
    mkdirSync('test-results', { recursive: true })
    writeFileSync('test-results/perf-index.json', JSON.stringify({ paths: 50_000, queryMs: Number(elapsed.toFixed(1)) }))
    expect(items.length).toBeGreaterThan(0)
    // GitHub Windows runners measured 74 ms (v2 algorithm: 134 ms); the 30 ms budget is for the daily-driver machine.
    expect(elapsed).toBeLessThan(process.env['CI'] ? 120 : 30)
  })
})
