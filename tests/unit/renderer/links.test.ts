import { describe, it, expect } from 'vitest'
import { parsePathRefs } from '@renderer/terminal/links'

describe('parsePathRefs', () => {
  it('finds relative and absolute paths with optional line and column', () => {
    const refs = parsePathRefs('error in src/app/workspace.ts:120:7 and ./README.md and /tmp/x.log:3')
    expect(refs.map((r) => [r.path, r.line, r.col])).toEqual([
      ['src/app/workspace.ts', 120, 7],
      ['./README.md', undefined, undefined],
      ['/tmp/x.log', 3, undefined],
    ])
    expect(refs[0]).toMatchObject({ start: 9, end: 35 })
  })

  it('handles windows paths and ignores urls', () => {
    const refs = parsePathRefs('see C:\\work\\a.txt:5 or https://example.com/x.ts')
    expect(refs.map((r) => r.path)).toEqual(['C:\\work\\a.txt'])
  })

  it('returns nothing for plain words', () => {
    expect(parsePathRefs('hello world 1.5 done')).toEqual([])
  })
})
