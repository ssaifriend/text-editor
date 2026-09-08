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

export type Editor = {
  readonly view: EditorView
  readonly setDoc: (text: string, language: Extension) => void
  readonly setWhitespace: (on: boolean) => void
}

export const createEditor = (parent: HTMLElement, onUpdate: (state: EditorState) => void): Editor => {
  const language = new Compartment()
  const whitespace = new Compartment()

  const extensionsFor = (lang: Extension, ws: Extension): Extension => [
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
    language.of(lang),
    whitespace.of(ws),
    EditorView.updateListener.of((update) => onUpdate(update.state)),
  ]

  const view = new EditorView({
    state: EditorState.create({ doc: '', extensions: extensionsFor([], []) }),
    parent,
  })

  const setDoc = (text: string, lang: Extension): void => {
    view.setState(EditorState.create({ doc: text, extensions: extensionsFor(lang, []) }))
  }

  const setWhitespace = (on: boolean): void => {
    view.dispatch({ effects: whitespace.reconfigure(on ? highlightWhitespace() : []) })
  }

  return { view, setDoc, setWhitespace }
}
