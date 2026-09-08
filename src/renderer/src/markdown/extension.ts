import { foldService, syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { wrapSelectionAsLink } from './commands'

type Options = { readonly linkOnPaste: () => boolean }

const headingLevel = (state: EditorState, lineFrom: number, text: string): number => {
  const node = syntaxTree(state).resolveInner(lineFrom, 1)
  const fromTree = /^ATXHeading([1-6])$/.exec(node.name) ?? /^ATXHeading([1-6])$/.exec(node.parent?.name ?? '')
  if (fromTree) return Number(fromTree[1])
  const fromText = /^(#{1,6})\s/.exec(text)
  return fromText ? fromText[1]!.length : 0
}

const headingFold = (state: EditorState, lineStart: number, lineEnd: number): { from: number; to: number } | null => {
  const line = state.doc.lineAt(lineStart)
  const level = headingLevel(state, line.from, line.text)
  if (level === 0) return null

  let last = line.number
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const next = state.doc.line(n)
    const nextLevel = headingLevel(state, next.from, next.text)
    if (nextLevel > 0 && nextLevel <= level) break
    last = n
  }
  return last === line.number ? null : { from: lineEnd, to: state.doc.line(last).to }
}

export const urlFromPaste = (text: string): string | null => {
  const trimmed = text.trim()
  return /^https?:\/\/\S+$/.test(trimmed) ? trimmed : null
}

const pasteHandler = (opts: Options) =>
  EditorView.domEventHandlers({
    paste: (event, view) => {
      if (!opts.linkOnPaste()) return false
      const url = urlFromPaste(event.clipboardData?.getData('text/plain') ?? '')
      if (!url) return false
      const spec = wrapSelectionAsLink(view.state, url)
      if (!spec) return false
      event.preventDefault()
      view.dispatch(spec, { userEvent: 'input.paste' })
      return true
    },
  })

export const markdownExtensions = (opts: Options): Extension => [foldService.of(headingFold), pasteHandler(opts)]
