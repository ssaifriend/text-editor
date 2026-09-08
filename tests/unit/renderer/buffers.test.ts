import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { createBuffer, isDirty, markSaved, titleOf, withLanguage, withState } from '@renderer/editor/buffers'

const makeState = (doc: string) => EditorState.create({ doc })

const opened = {
  path: '/p/a.ts', text: 'hello', encoding: 'utf8' as const, bom: false, eol: 'lf' as const, mixedEol: false,
  confidence: 'high' as const, hash: 'h1', mtimeMs: 1, readonly: false, largeFile: false,
}

describe('buffers', () => {
  it('creates a clean buffer from an opened file', () => {
    const b = createBuffer('b1', opened, makeState)
    expect(b.meta?.path).toBe('/p/a.ts')
    expect(b.languageId).toBe('typescript')
    expect(b.state.doc.toString()).toBe('hello')
    expect(isDirty(b)).toBe(false)
    expect(titleOf(b)).toBe('a.ts')
  })

  it('creates an empty untitled buffer', () => {
    const b = createBuffer('b2', null, makeState)
    expect(b.meta).toBeNull()
    expect(b.languageId).toBe('plain')
    expect(isDirty(b)).toBe(false)
    expect(titleOf(b)).toBe('untitled')
  })

  it('becomes dirty when the doc changes and clean again when it matches savedDoc', () => {
    const b = createBuffer('b1', opened, makeState)
    const edited = withState(b, b.state.update({ changes: { from: 5, insert: '!' } }).state)
    expect(isDirty(edited)).toBe(true)

    const reverted = withState(edited, edited.state.update({ changes: { from: 5, to: 6 } }).state)
    expect(isDirty(reverted)).toBe(false)
  })

  it('markSaved adopts the current doc and new meta', () => {
    const b = createBuffer('b1', opened, makeState)
    const edited = withState(b, b.state.update({ changes: { from: 5, insert: '!' } }).state)
    const saved = markSaved(edited, { ...opened, hash: 'h2' })
    expect(isDirty(saved)).toBe(false)
    expect(saved.meta?.hash).toBe('h2')
  })

  it('withLanguage rebuilds the state but keeps doc and selection', () => {
    const b = createBuffer('b1', opened, makeState)
    const moved = withState(b, b.state.update({ selection: { anchor: 3 } }).state)
    const relanged = withLanguage(moved, 'python', makeState)
    expect(relanged.languageId).toBe('python')
    expect(relanged.state.doc.toString()).toBe('hello')
    expect(relanged.state.selection.main.head).toBe(3)
    expect(isDirty(relanged)).toBe(false)
  })
})
