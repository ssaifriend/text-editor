import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rgPath } from '@vscode/ripgrep'
import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import type { SearchDone, SearchMatch } from '../../../src/shared/search'
import { createSearchService } from '../../../src/main/search/run'

type Listener = (channel: string, payload: { id: string }) => void
const listeners: Listener[] = []
const push = ((channel: string, payload: unknown) => listeners.forEach((l) => l(channel, payload as { id: string }))) as never

const settings = () => ({ encoding: 'auto', maxFileSizeMb: 10, exclude: [] })
const spec = { pattern: 'needle', regexp: false, caseSensitive: false, wholeWord: false, include: '', exclude: '' }

const collect = (id: string, run: () => void) =>
  new Promise<{ matches: SearchMatch[]; done: SearchDone }>((resolve) => {
    const matches: SearchMatch[] = []
    listeners.push((channel, payload) => {
      if (payload.id !== id) return
      if (channel === 'search.batch') matches.push(...(payload as { matches: SearchMatch[] }).matches)
      if (channel === 'search.done') resolve({ matches, done: payload as SearchDone })
    })
    run()
  })

let root: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'moru-search-'))
  mkdirSync(join(root, 'sub'))
  writeFileSync(join(root, 'a.txt'), 'x\nthe Needle here\nneedle again needle\n')
  writeFileSync(join(root, 'sub', 'b.md'), '# no\n')
  writeFileSync(join(root, 'sub', 'c.ts'), 'const needle = 1\n')
  writeFileSync(join(root, '.gitignore'), 'ignored.txt\n')
  writeFileSync(join(root, 'ignored.txt'), 'needle\n')
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('search service', () => {
  it('streams matches with UTF-16 offsets, counts files and respects .gitignore', async () => {
    const service = createSearchService({ rgPath, push, settings, batchMs: 10 })
    const { matches, done } = await collect('q1', () => service.run('q1', spec, [root]))
    expect(done).toEqual({ id: 'q1', files: 2, matches: 4, truncated: false, error: null })
    expect(matches.map((m) => [m.path.replace(root, '').replaceAll('\\', '/'), m.line, m.from, m.to]).sort()).toEqual([
      ['/a.txt', 2, 4, 10],
      ['/a.txt', 3, 0, 6],
      ['/a.txt', 3, 13, 19],
      ['/sub/c.ts', 1, 6, 12],
    ])
    service.dispose()
  })

  it('reports regex errors and honours the cap', async () => {
    const service = createSearchService({ rgPath, push, settings, batchMs: 10, cap: 2 })
    const bad = await collect('q2', () => service.run('q2', { ...spec, regexp: true, pattern: '(' }, [root]))
    expect(bad.done.error).toMatch(/regex|parse|unclosed/i)
    const capped = await collect('q3', () => service.run('q3', spec, [root]))
    expect(capped.done.truncated).toBe(true)
    expect(capped.matches.length).toBeLessThanOrEqual(4)
    service.dispose()
  })

  it('cancel suppresses done and a re-run with the same id replaces the previous query', async () => {
    const service = createSearchService({ rgPath, push, settings, batchMs: 10 })
    let doneCount = 0
    listeners.push((channel, payload) => {
      if (channel === 'search.done' && payload.id === 'q4') doneCount += 1
    })
    service.run('q4', spec, [root])
    service.cancel('q4')
    const again = await collect('q4', () => service.run('q4', spec, [root]))
    expect(again.done.matches).toBe(4)
    await new Promise((r) => setTimeout(r, 50))
    expect(doneCount).toBe(1)
    service.dispose()
  })

  it('finishes a 10k-file fixture within budget', async () => {
    const big = mkdtempSync(join(tmpdir(), 'moru-search-big-'))
    for (let d = 0; d < 100; d++) {
      mkdirSync(join(big, `d${d}`))
      for (let f = 0; f < 100; f++) writeFileSync(join(big, `d${d}`, `f${f}.txt`), `line one\n${f % 10 === 0 ? 'needle' : 'hay'} ${d}-${f}\n`)
    }
    const service = createSearchService({ rgPath, push, settings, batchMs: 50 })
    const started = performance.now()
    const { done } = await collect('big', () => service.run('big', spec, [big]))
    const elapsed = performance.now() - started
    console.log(`10k-file search: ${elapsed.toFixed(0)} ms`)
    expect(done.matches).toBe(1000)
    expect(done.files).toBe(1000)
    expect(elapsed).toBeLessThan(process.env['CI'] ? 6000 : 3000)
    service.dispose()
    rmSync(big, { recursive: true, force: true })
  }, 60_000)
})
