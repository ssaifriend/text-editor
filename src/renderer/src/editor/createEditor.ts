import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { compositionObserver } from './compositionObserver'

export type ViewHooks = {
  readonly onUpdate: (state: EditorState, view: EditorView) => void
}

export const baseExtensions = (language: Extension, hooks: ViewHooks): Extension => [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  history(),
  drawSelection(),
  EditorState.allowMultipleSelections.of(true),
  rectangularSelection(),
  crosshairCursor(),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  highlightSelectionMatches(),
  keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
  compositionObserver,
  language,
  EditorView.updateListener.of((update) => {
    if (update.docChanged || update.selectionSet) hooks.onUpdate(update.state, update.view)
  }),
]

export const makeState = (doc: string, extensions: Extension): EditorState => EditorState.create({ doc, extensions })

export const createView = (parent: HTMLElement, state: EditorState): EditorView => new EditorView({ state, parent })
