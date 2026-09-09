import { describe, it, expect } from 'vitest'
import { pathCandidates } from '@renderer/editor/pathCandidates'

describe('pathCandidates', () => {
  it('returns absolute and home paths as-is', () => {
    expect(pathCandidates('/etc/hosts', '/p/a.ts', '/p', null)).toEqual(['/etc/hosts'])
    expect(pathCandidates('~/x.md', '/p/a.ts', '/p', null)).toEqual(['~/x.md'])
  })

  it('resolves relative refs against the buffer dir, the project root and the terminal cwd, deduplicated', () => {
    expect(pathCandidates('./b.ts', '/p/src/a.ts', '/p', '/p/src')).toEqual(['/p/src/b.ts', '/p/b.ts'])
    expect(pathCandidates('../lib/c.ts', '/p/src/a.ts', null, null)).toEqual(['/p/lib/c.ts'])
    expect(pathCandidates('docs/x.md', null, '/p', '/w')).toEqual(['/p/docs/x.md', '/w/docs/x.md'])
  })
})
