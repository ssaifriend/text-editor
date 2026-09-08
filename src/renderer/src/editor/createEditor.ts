import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  rectangularSelection,
} from '@codemirror/view'
import { compositionObserver } from './compositionObserver'
import { externalChangeAnnotation } from './externalChange'

export type ViewHooks = {
  readonly onUpdate: (state: EditorState, view: EditorView, external: boolean) => void
}

export const baseExtensions = (language: Extension, hooks: ViewHooks): Extension => [
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
  highlightSelectionMatches(),
  keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
  compositionObserver,
  language,
  EditorView.updateListener.of((update) => {
    if (!update.docChanged && !update.selectionSet) return
    const external = update.transactions.some((tr) => tr.annotation(externalChangeAnnotation) === true)
    hooks.onUpdate(update.state, update.view, external)
  }),
]

export const makeState = (doc: string, extensions: Extension): EditorState => EditorState.create({ doc, extensions })

export const createView = (parent: HTMLElement, state: EditorState): EditorView => new EditorView({ state, parent })
