import { EditorState } from '@codemirror/state'
import { describe, it, expect } from 'vitest'
import { searchState } from '@renderer/search/local'
import {
  appendBatch,
  bufferEdits,
  emptySearch,
  includedCount,
  isIncluded,
  matchKey,
  planFor,
  previewOf,
  replaceFileResults,
  toggleExcluded,
} from '@renderer/search/state'

const spec = { pattern: 'foo', regexp: false, caseSensitive: false, wholeWord: false, include: '', exclude: '' }
const m = (path: string, line: number, text: string, from: number) => ({ path, line, text, from, to: from + 3 })

describe('search state', () => {
  it('groups batches by path in arrival order and keeps buffer-sourced files authoritative', () => {
    let s = emptySearch('q', spec)
    s = appendBatch(s, [m('/a', 1, 'foo foo', 0), m('/a', 1, 'foo foo', 4), m('/b', 2, 'x foo', 2)])
    expect(s.files.map((f) => [f.path, f.matches.length, f.source])).toEqual([['/a', 2, 'disk'], ['/b', 1, 'disk']])

    s = replaceFileResults(s, '/a', [m('/a', 5, 'FOO', 0)])
    s = appendBatch(s, [m('/a', 9, 'foo', 0)])
    expect(s.files[0]).toMatchObject({ path: '/a', source: 'buffer', matches: [m('/a', 5, 'FOO', 0)] })
    expect(s.total).toBe(2)
    expect(replaceFileResults(s, '/b', []).files.map((f) => f.path)).toEqual(['/a'])
  })

  it('excludes by file or by match and previews with case preservation', () => {
    let s = {
      ...appendBatch(emptySearch('q', spec), [m('/a', 1, 'foo Foo', 0), m('/a', 1, 'foo Foo', 4), m('/b', 1, 'foo', 0)]),
      replacement: 'bar',
      preserveCase: true,
    }
    expect(previewOf(s, m('/a', 1, 'foo Foo', 4))).toBe('Bar')
    expect(matchKey(m('/a', 1, 'foo Foo', 4), 1)).toBe('/a:1:1')

    s = toggleExcluded(s, '/a:1:1')
    expect(isIncluded(s, m('/a', 1, 'foo Foo', 4), 1)).toBe(false)
    expect(isIncluded(s, m('/a', 1, 'foo Foo', 0), 0)).toBe(true)

    s = toggleExcluded(s, '/b')
    expect(includedCount(s)).toEqual({ files: 1, matches: 1 })
    expect(planFor(s, { '/a': 'h1', '/b': 'h2' })).toEqual({
      spec,
      replacement: 'bar',
      preserveCase: true,
      files: [{ path: '/a', hash: 'h1', lines: [{ line: 1, skip: [1] }] }],
    })
    expect(previewOf({ ...s, replacement: '' }, m('/a', 1, 'foo Foo', 0))).toBeNull()
  })

  it('computes absolute buffer edits and local matches', () => {
    const state = EditorState.create({ doc: '한 foo\nfoo x foo\n' })
    const local = searchState(spec, '/a', state)
    expect(local).toEqual([m('/a', 1, '한 foo', 2), m('/a', 2, 'foo x foo', 0), m('/a', 2, 'foo x foo', 6)])

    const s = { ...replaceFileResults(emptySearch('q', spec), '/a', local), replacement: 'b', preserveCase: false }
    expect(bufferEdits(toggleExcluded(s, '/a:2:0'), '/a', state)).toEqual([
      { from: 2, to: 5, insert: 'b' },
      { from: 12, to: 15, insert: 'b' },
    ])
  })
})
