import {
  copyLineDown,
  cursorMatchingBracket,
  deleteLine,
  indentLess,
  indentMore,
  insertBlankLine,
  moveLineDown,
  moveLineUp,
  redo,
  redoSelection,
  selectAll,
  selectLine,
  selectParentSyntax,
  toggleComment,
  undo,
  undoSelection,
} from '@codemirror/commands'
import { selectNextOccurrence, selectSelectionMatches } from '@codemirror/search'
import { EditorSelection } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'

export type EditorCommandSpec = { readonly id: string; readonly title: string; readonly run: Command }

const insertLineBefore: Command = (view: EditorView) => {
  const { state } = view
  view.dispatch(
    state.changeByRange((range) => {
      const line = state.doc.lineAt(range.head)
      return { changes: { from: line.from, insert: '\n' }, range: EditorSelection.cursor(line.from) }
    }),
    { scrollIntoView: true, userEvent: 'input' },
  )
  return true
}

export const editorCommands: readonly EditorCommandSpec[] = [
  { id: 'editor.toggleComment', title: 'Toggle Comment', run: toggleComment },
  { id: 'editor.duplicateLine', title: 'Duplicate Line', run: copyLineDown },
  { id: 'editor.deleteLine', title: 'Delete Line', run: deleteLine },
  { id: 'editor.selectLine', title: 'Expand Selection to Line', run: selectLine },
  { id: 'editor.insertLineAfter', title: 'Insert Line After', run: insertBlankLine },
  { id: 'editor.insertLineBefore', title: 'Insert Line Before', run: insertLineBefore },
  { id: 'editor.indentMore', title: 'Indent', run: indentMore },
  { id: 'editor.indentLess', title: 'Unindent', run: indentLess },
  { id: 'editor.selectNextOccurrence', title: 'Quick Add Next', run: selectNextOccurrence },
  { id: 'editor.selectAllOccurrences', title: 'Quick Find All', run: selectSelectionMatches },
  { id: 'editor.undoSelection', title: 'Soft Undo', run: undoSelection },
  { id: 'editor.redoSelection', title: 'Soft Redo', run: redoSelection },
  { id: 'editor.matchingBracket', title: 'Jump to Matching Bracket', run: cursorMatchingBracket },
  { id: 'editor.selectParent', title: 'Expand Selection to Scope', run: selectParentSyntax },
  { id: 'editor.moveLineUp', title: 'Swap Line Up', run: moveLineUp },
  { id: 'editor.moveLineDown', title: 'Swap Line Down', run: moveLineDown },
  { id: 'editor.undo', title: 'Undo', run: undo },
  { id: 'editor.redo', title: 'Redo', run: redo },
  { id: 'editor.selectAll', title: 'Select All', run: selectAll },
]
