import { describe, it, expect } from 'vitest'
import { parseGotoQuery } from '@renderer/goto/parse'

describe('parseGotoQuery', () => {
  it.each([
    ['', { mode: 'files', file: '', symbol: null, line: null, col: null, word: null }],
    ['wksp', { mode: 'files', file: 'wksp', symbol: null, line: null, col: null, word: null }],
    ['@render', { mode: 'symbols', file: '', symbol: 'render', line: null, col: null, word: null }],
    [':12', { mode: 'lines', file: '', symbol: null, line: 12, col: null, word: null }],
    [':12:5', { mode: 'lines', file: '', symbol: null, line: 12, col: 5, word: null }],
    ['#todo', { mode: 'words', file: '', symbol: null, line: null, col: null, word: 'todo' }],
    ['wksp@render', { mode: 'files', file: 'wksp', symbol: 'render', line: null, col: null, word: null }],
    ['wksp:12', { mode: 'files', file: 'wksp', symbol: null, line: 12, col: null, word: null }],
    [':abc', { mode: 'lines', file: '', symbol: null, line: null, col: null, word: null }],
  ])('%s', (text, expected) => {
    expect(parseGotoQuery(text)).toEqual(expected)
  })
})
