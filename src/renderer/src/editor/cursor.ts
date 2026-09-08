import type { EditorState } from '@codemirror/state'
import { graphemeCount } from './text'

export type CursorPosition = { readonly line: number; readonly col: number }

export const cursorPosition = (state: EditorState): CursorPosition => {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const before = line.text.slice(0, head - line.from)

  return { line: line.number, col: graphemeCount(before) + 1 }
}
