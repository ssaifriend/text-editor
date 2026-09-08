import { describe, it, expect } from 'vitest'
import { expandReplacement, matchesInLine, preserveCaseOf, replaceInLine, toRegExp } from '../../../src/shared/replaceText'

const lit = { pattern: 'foo', regexp: false, caseSensitive: false, wholeWord: false }

describe('toRegExp', () => {
  it('escapes literals and applies case/word flags', () => {
    expect(toRegExp(lit)!.source).toBe('foo')
    expect(toRegExp({ ...lit, pattern: 'a.b(' })!.test('a.b(')).toBe(true)
    expect(toRegExp({ ...lit, pattern: 'a.b(' })!.test('axb(')).toBe(false)
    expect(toRegExp({ ...lit, caseSensitive: true })!.flags).toBe('gu')
    expect(toRegExp(lit)!.flags).toBe('giu')
    const word = toRegExp({ ...lit, wholeWord: true })!
    expect('foo foobar 한글foo'.match(word)?.length).toBe(1)
  })

  it('returns null for an invalid or empty regex', () => {
    expect(toRegExp({ ...lit, regexp: true, pattern: '(' })).toBeNull()
    expect(toRegExp({ ...lit, pattern: '' })).toBeNull()
  })
})

describe('expandReplacement', () => {
  it('expands groups, named groups, $$ and escapes in regex mode only', () => {
    const re = /(?<first>\w+)-(\w+)/gu
    const m = re.exec('ab-cd')!
    expect(expandReplacement(m, '$2_$<first>$$\\n', true)).toBe('cd_ab$\n')
    expect(expandReplacement(m, '$2_$1', false)).toBe('$2_$1')
  })
})

describe('preserveCaseOf', () => {
  it('mirrors ALL CAPS, Capitalized and lower', () => {
    expect(preserveCaseOf('FOO', 'bar')).toBe('BAR')
    expect(preserveCaseOf('Foo', 'bar')).toBe('Bar')
    expect(preserveCaseOf('foo', 'Bar')).toBe('bar')
    expect(preserveCaseOf('fOo', 'bar')).toBe('bar')
  })
})

describe('replaceInLine', () => {
  it('replaces every match on the line and reports edits in UTF-16 offsets', () => {
    const r = replaceInLine('한글 foo Foo', lit, 'bar', true)!
    expect(r.text).toBe('한글 bar Bar')
    expect(r.edits).toEqual([
      { from: 3, to: 6, insert: 'bar' },
      { from: 7, to: 10, insert: 'Bar' },
    ])
  })

  it('skips excluded match indexes and returns null when nothing matches', () => {
    expect(replaceInLine('foo foo', lit, 'x', false, [0])).toEqual({ text: 'foo x', edits: [{ from: 4, to: 7, insert: 'x' }] })
    expect(replaceInLine('nope', lit, 'x', false)).toBeNull()
  })

  it('matchesInLine handles zero-width regex without looping forever', () => {
    expect(matchesInLine('abc', /x*/gu).length).toBe(4)
  })
})
