import { EditorState } from '@codemirror/state'
import { describe, it, expect } from 'vitest'
import { saveChanges } from '@renderer/editor/saveTransforms'

const apply = (doc: string, opts: { trimTrailingWhitespace: boolean; insertFinalNewline: boolean }) => {
  const state = EditorState.create({ doc })
  return state.update({ changes: saveChanges(state, opts) }).state.doc.toString()
}
const both = { trimTrailingWhitespace: true, insertFinalNewline: true }

describe('saveChanges', () => {
  it('trims trailing spaces and tabs on every line', () => {
    expect(apply('a  \nb\t\n  c \n', { ...both, insertFinalNewline: false })).toBe('a\nb\n  c\n')
  })

  it('adds a final newline only when missing and the doc is non-empty', () => {
    expect(apply('a\nb', { ...both, trimTrailingWhitespace: false })).toBe('a\nb\n')
    expect(apply('a\nb\n', both)).toBe('a\nb\n')
    expect(apply('', both)).toBe('')
  })

  it('does both and is a no-op on clean documents', () => {
    expect(apply('x   ', both)).toBe('x\n')
    expect(saveChanges(EditorState.create({ doc: 'clean\n' }), both)).toEqual([])
    expect(saveChanges(EditorState.create({ doc: 'a  \n' }), { trimTrailingWhitespace: false, insertFinalNewline: false })).toEqual([])
  })
})
