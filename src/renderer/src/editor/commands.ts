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
import { SearchCursor, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search'
import { EditorSelection, type EditorState, type SelectionRange } from '@codemirror/state'
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

const splitSelectionIntoLines: Command = (view) => {
  const { state } = view
  const ranges = state.selection.ranges.flatMap((range) => {
    if (range.empty) return [range]
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    return Array.from({ length: last - first + 1 }, (_, i) => {
      const line = state.doc.line(first + i)
      return EditorSelection.cursor(i === last - first ? Math.min(line.to, range.to) : line.to)
    })
  })
  view.dispatch({ selection: EditorSelection.create(ranges, ranges.length - 1) })
  return true
}

const addCursor =
  (delta: 1 | -1): Command =>
  (view) => {
    const { state } = view
    const existing = state.selection.ranges.map((r) => r.head)
    const added = state.selection.ranges.flatMap((range) => {
      const line = state.doc.lineAt(range.head)
      const target = line.number + delta
      if (target < 1 || target > state.doc.lines) return []
      const goal = range.goalColumn ?? range.head - line.from
      const next = state.doc.line(target)
      const pos = Math.min(next.from + goal, next.to)
      return existing.includes(pos) ? [] : [EditorSelection.cursor(pos, undefined, undefined, goal)]
    })
    if (added.length === 0) return false

    const all = [...state.selection.ranges, ...added]
    view.dispatch({ selection: EditorSelection.create(all, all.length - 1) })
    return true
  }

const nextOccurrenceAfter = (state: EditorState, text: string, from: number, taken: readonly SelectionRange[]): SelectionRange | null => {
  const isTaken = (start: number): boolean => taken.some((r) => r.from === start)
  const search = (start: number, end: number): SelectionRange | null => {
    const cursor = new SearchCursor(state.doc, text, start, end)
    while (!cursor.next().done) {
      if (!isTaken(cursor.value.from)) return EditorSelection.range(cursor.value.from, cursor.value.to)
    }
    return null
  }
  return search(from, state.doc.length) ?? search(0, from)
}

const skipOccurrence: Command = (view) => {
  const { state } = view
  const main = state.selection.main
  if (main.empty) return selectNextOccurrence(view)

  const rest = state.selection.ranges.filter((r) => r !== main)
  const text = state.sliceDoc(main.from, main.to)
  const next = nextOccurrenceAfter(state, text, main.to, state.selection.ranges)
  const ranges = next ? [...rest, next] : rest
  if (ranges.length === 0) return false

  view.dispatch({ selection: EditorSelection.create(ranges, ranges.length - 1), scrollIntoView: true })
  return true
}

export const editorCommands: readonly EditorCommandSpec[] = [
  { id: 'editor.splitSelectionIntoLines', title: 'Split Selection into Lines', run: splitSelectionIntoLines },
  { id: 'editor.addCursorAbove', title: 'Add Cursor Above', run: addCursor(-1) },
  { id: 'editor.addCursorBelow', title: 'Add Cursor Below', run: addCursor(1) },
  { id: 'editor.skipOccurrence', title: 'Quick Skip Next', run: skipOccurrence },
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
