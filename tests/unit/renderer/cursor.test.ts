import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { cursorPosition } from '@renderer/editor/cursor'

describe('cursorPosition', () => {
  it('is 1-based at document start', () => {
    const state = EditorState.create({ doc: 'abc', selection: { anchor: 0 } })
    expect(cursorPosition(state)).toEqual({ line: 1, col: 1 })
  })

  it('counts Hangul as one column each', () => {
    const state = EditorState.create({ doc: 'ab\n한글c', selection: { anchor: 6 } })
    expect(cursorPosition(state)).toEqual({ line: 2, col: 4 })
  })

  it('counts an emoji as one column even though it is two UTF-16 units', () => {
    const state = EditorState.create({ doc: '😀x', selection: { anchor: 3 } })
    expect(cursorPosition(state)).toEqual({ line: 1, col: 3 })
  })
})
