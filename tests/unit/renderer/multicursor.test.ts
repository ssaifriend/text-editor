import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { Command } from '@codemirror/view'
import { editorCommands } from '@renderer/editor/commands'

const cmd = (id: string): Command => editorCommands.find((c) => c.id === id)!.run
const run = (command: Command, state: EditorState): EditorState => {
  let next = state
  const dispatch = (spec: { state?: EditorState } & Record<string, unknown>): void => {
    next = spec.state instanceof EditorState ? spec.state : state.update(spec as never).state
  }
  command({ state, dispatch } as never)
  return next
}
const ranges = (s: EditorState) => s.selection.ranges.map((r) => [r.anchor, r.head])
const multi = EditorState.allowMultipleSelections.of(true)

describe('splitSelectionIntoLines', () => {
  it('puts a cursor at the end of each selected line', () => {
    const state = EditorState.create({ doc: 'ab\ncd\nef\n', selection: { anchor: 0, head: 7 }, extensions: multi })
    expect(ranges(run(cmd('editor.splitSelectionIntoLines'), state))).toEqual([[2, 2], [5, 5], [7, 7]])
  })
})

describe('addCursorAbove/Below', () => {
  it('adds cursors on neighbouring lines at the same column, clamped', () => {
    const state = EditorState.create({ doc: 'abcd\nab\nabcd\n', selection: { anchor: 3 }, extensions: multi })
    const below = run(cmd('editor.addCursorBelow'), state)
    expect(ranges(below)).toEqual([[3, 3], [7, 7]])
    const below2 = run(cmd('editor.addCursorBelow'), below)
    expect(ranges(below2)).toEqual([[3, 3], [7, 7], [11, 11]])
    const above = run(cmd('editor.addCursorAbove'), EditorState.create({ doc: 'ab\nabcd\n', selection: { anchor: 6 }, extensions: multi }))
    expect(ranges(above)).toEqual([[2, 2], [6, 6]])
  })
})

describe('skipOccurrence', () => {
  it('drops the last added occurrence and selects the next one', () => {
    const doc = 'foo bar foo baz foo\n'
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(8, 11)], 1),
      extensions: multi,
    })
    const next = run(cmd('editor.skipOccurrence'), state)
    expect(ranges(next)).toEqual([[0, 3], [16, 19]])
  })
})
