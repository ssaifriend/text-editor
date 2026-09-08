import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { defaultFindSpec, inSelectionField, preserveCaseOf, setInSelectionRanges } from '@renderer/find/state'
import { buildQuery, countMatches, currentMatchIndex } from '@renderer/find/query'

const doc = 'foo Foo FOO foobar\nfoo\n'

describe('preserveCaseOf', () => {
  it('mirrors the case pattern of the sample', () => {
    expect(preserveCaseOf('FOO', 'bar')).toBe('BAR')
    expect(preserveCaseOf('Foo', 'bar')).toBe('Bar')
    expect(preserveCaseOf('foo', 'Bar')).toBe('bar')
    expect(preserveCaseOf('fOO', 'bar')).toBe('bar')
  })
})

describe('buildQuery / countMatches', () => {
  it('counts plain, case-insensitive matches', () => {
    const state = EditorState.create({ doc })
    const q = buildQuery({ ...defaultFindSpec, search: 'foo' }, null)
    expect(countMatches(q, state)).toEqual({ count: 5, capped: false })
  })

  it('honours case, whole word and regexp', () => {
    const state = EditorState.create({ doc })
    expect(countMatches(buildQuery({ ...defaultFindSpec, search: 'foo', caseSensitive: true }, null), state).count).toBe(3)
    expect(countMatches(buildQuery({ ...defaultFindSpec, search: 'foo', caseSensitive: true, wholeWord: true }, null), state).count).toBe(2)
    expect(countMatches(buildQuery({ ...defaultFindSpec, search: 'fo+b', regexp: true }, null), state).count).toBe(1)
  })

  it('restricts to in-selection ranges and maps them through changes', () => {
    const base = EditorState.create({ doc, extensions: inSelectionField })
    const withRanges = base.update({ effects: setInSelectionRanges.of([{ from: 0, to: 7 }]) }).state
    const q = buildQuery({ ...defaultFindSpec, search: 'foo', inSelection: true }, withRanges.field(inSelectionField))
    expect(countMatches(q, withRanges).count).toBe(2)

    const shifted = withRanges.update({ changes: { from: 0, insert: 'xx ' } }).state
    const ranges = shifted.field(inSelectionField)
    expect(ranges?.[0]?.from).toBe(3)
    expect(ranges?.[0]?.to).toBe(10)
  })

  it('reports the 1-based index of the selected match', () => {
    const state = EditorState.create({ doc, selection: EditorSelection.single(4, 7) })
    const q = buildQuery({ ...defaultFindSpec, search: 'foo' }, null)
    expect(currentMatchIndex(q, state)).toBe(2)
    expect(currentMatchIndex(q, EditorState.create({ doc }))).toBeNull()
  })

  it('caps the count', () => {
    const state = EditorState.create({ doc: 'a'.repeat(50) })
    expect(countMatches(buildQuery({ ...defaultFindSpec, search: 'a' }, null), state, 10)).toEqual({ count: 10, capped: true })
  })
})
