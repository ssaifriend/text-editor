import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { defaultFindSpec } from '@renderer/find/state'
import { buildQuery } from '@renderer/find/query'
import { replaceAllPreserving, replaceNextPreserving } from '@renderer/find/replace'

const doc = 'foo Foo FOO x\n'

describe('replace with preserve case', () => {
  it('replaceAll mirrors case per match', () => {
    const state = EditorState.create({ doc })
    const q = buildQuery({ ...defaultFindSpec, search: 'foo', replace: 'bar', preserveCase: true }, null)
    const spec = replaceAllPreserving(state, q)
    expect(spec).not.toBeNull()
    expect(state.update(spec!).state.doc.toString()).toBe('bar Bar BAR x\n')
  })

  it('replaceNext replaces the match at the selection and selects the following one', () => {
    const state = EditorState.create({ doc, selection: EditorSelection.single(4, 7) })
    const q = buildQuery({ ...defaultFindSpec, search: 'foo', replace: 'bar', preserveCase: true }, null)
    const next = state.update(replaceNextPreserving(state, q)!).state
    expect(next.doc.toString()).toBe('foo Bar FOO x\n')
    expect([next.selection.main.from, next.selection.main.to]).toEqual([8, 11])
  })

  it('replaceNext with regexp groups keeps CM6 semantics when preserveCase is off', () => {
    const state = EditorState.create({ doc: 'a1 b2\n', selection: EditorSelection.single(0, 2) })
    const q = buildQuery({ ...defaultFindSpec, search: '([a-z])(\\d)', replace: '$2$1', regexp: true }, null)
    const next = state.update(replaceNextPreserving(state, q, false)!).state
    expect(next.doc.toString()).toBe('1a b2\n')
  })

  it('returns null when nothing matches', () => {
    const state = EditorState.create({ doc })
    expect(replaceAllPreserving(state, buildQuery({ ...defaultFindSpec, search: 'zzz', replace: 'y' }, null))).toBeNull()
  })
})
