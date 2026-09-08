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
    const started = performance.now()
    const items = m.query('mod12fil', 50)
    const elapsed = performance.now() - started
    mkdirSync('test-results', { recursive: true })
    writeFileSync('test-results/perf-index.json', JSON.stringify({ paths: 50_000, queryMs: Number(elapsed.toFixed(1)) }))
    expect(items.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(process.env['CI'] ? 60 : 30)
  })
})
