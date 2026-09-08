import { describe, it, expect } from 'vitest'
import { byteToCharOffset, parseRgLine } from '../../../src/main/search/rgJson'

const matchLine = JSON.stringify({
  type: 'match',
  data: {
    path: { text: '/r/a.ts' },
    lines: { text: '한글 foo 한 foo\n' },
    line_number: 3,
    absolute_offset: 100,
    submatches: [
      { match: { text: 'foo' }, start: 7, end: 10 },
      { match: { text: 'foo' }, start: 15, end: 18 },
    ],
  },
})

describe('parseRgLine', () => {
  it('converts byte submatch offsets to UTF-16 offsets and strips the line terminator', () => {
    expect(parseRgLine(matchLine)).toEqual({
      kind: 'match',
      matches: [
        { path: '/r/a.ts', line: 3, text: '한글 foo 한 foo', from: 3, to: 6 },
        { path: '/r/a.ts', line: 3, text: '한글 foo 한 foo', from: 9, to: 12 },
      ],
    })
  })

  it('maps end/summary and tolerates garbage', () => {
    expect(parseRgLine(JSON.stringify({ type: 'end', data: { path: { text: '/r/a.ts' } } }))).toEqual({ kind: 'end', path: '/r/a.ts' })
    expect(parseRgLine(JSON.stringify({ type: 'summary', data: { stats: { matches: 7 } } }))).toEqual({ kind: 'summary', matched: 7 })
    expect(parseRgLine('not json')).toEqual({ kind: 'other' })
    expect(
      parseRgLine(JSON.stringify({ type: 'match', data: { path: { bytes: 'AA==' }, lines: { text: 'x' }, line_number: 1, submatches: [] } })),
    ).toEqual({ kind: 'other' })
  })

  it('byteToCharOffset clamps', () => {
    expect(byteToCharOffset('한a', 3)).toBe(1)
    expect(byteToCharOffset('한a', 99)).toBe(2)
  })
})
