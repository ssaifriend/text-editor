import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightWhitespace,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { compositionObserver } from './compositionObserver'

export type ViewHooks = {
  readonly onUpdate: (state: EditorState, view: EditorView) => void
  readonly onFocusChange: (view: EditorView, focused: boolean) => void
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
    if (update.docChanged || update.selectionSet || update.focusChanged) hooks.onUpdate(update.state, update.view)
    if (update.focusChanged) hooks.onFocusChange(update.view, update.view.hasFocus)
  }),
]

export const makeState = (doc: string, extensions: Extension): EditorState => EditorState.create({ doc, extensions })

export const createView = (parent: HTMLElement, state: EditorState): EditorView => new EditorView({ state, parent })

export type Editor = {
  readonly view: EditorView
  readonly setDoc: (text: string, language: Extension) => void
  readonly setWhitespace: (on: boolean) => void
}

export const createEditor = (parent: HTMLElement, onUpdate: (state: EditorState) => void): Editor => {
  const whitespace = new Compartment()
  const hooks: ViewHooks = { onUpdate: (state) => onUpdate(state), onFocusChange: () => undefined }
  const extensionsFor = (lang: Extension): Extension => [baseExtensions(lang, hooks), whitespace.of([])]

  const view = createView(parent, makeState('', extensionsFor([])))

  return {
    view,
    setDoc: (text, lang) => view.setState(makeState(text, extensionsFor(lang))),
    setWhitespace: (on) => view.dispatch({ effects: whitespace.reconfigure(on ? highlightWhitespace() : []) }),
  }
}
