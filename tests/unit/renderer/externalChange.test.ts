import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { changeSetFromDiff } from '@renderer/editor/externalChange'

describe('changeSetFromDiff', () => {
  it('produces changes that transform old into new and keep unrelated cursor positions', () => {
    const oldText = 'const a = 1\nconst b = 2\nconst c = 3\n'
    const newText = 'const a = 1\nconst b = 22\nconst c = 3\nconst d = 4\n'
    const state = EditorState.create({ doc: oldText, selection: { anchor: 5 } })
    const tr = state.update({ changes: changeSetFromDiff(oldText, newText) })
    expect(tr.state.doc.toString()).toBe(newText)
    expect(tr.state.selection.main.head).toBe(5)
  })

  it('returns no changes for identical text', () => {
    expect(changeSetFromDiff('same', 'same')).toEqual([])
  })
})
