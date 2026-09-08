import type { ChangeSpec, EditorState } from '@codemirror/state'

export type SaveOptions = { readonly trimTrailingWhitespace: boolean; readonly insertFinalNewline: boolean }

export const saveChanges = (state: EditorState, opts: SaveOptions): ChangeSpec[] => {
  const changes: ChangeSpec[] = []
  const doc = state.doc

  if (opts.trimTrailingWhitespace) {
    for (let n = 1; n <= doc.lines; n++) {
      const line = doc.line(n)
      const m = /[ \t]+$/.exec(line.text)
      if (m) changes.push({ from: line.to - m[0].length, to: line.to })
    }
  }

  if (opts.insertFinalNewline && doc.length > 0 && doc.sliceString(doc.length - 1) !== '\n') {
    changes.push({ from: doc.length, insert: '\n' })
  }

  return changes
}
