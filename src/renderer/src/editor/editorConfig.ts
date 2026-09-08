import { indentUnit } from '@codemirror/language'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, highlightWhitespace, lineNumbers } from '@codemirror/view'
import type { EditorSettings } from '@shared/config'

export const settingsCompartment = new Compartment()

export const configExtensions = (s: EditorSettings): Extension => [
  EditorState.tabSize.of(s.tabSize),
  indentUnit.of(s.insertSpaces ? ' '.repeat(s.tabSize) : '\t'),
  s.wordWrap ? EditorView.lineWrapping : [],
  s.lineNumbers ? lineNumbers() : [],
  s.highlightWhitespace ? highlightWhitespace() : [],
]

export const cssFontFamily = (families: readonly string[]): string =>
  families.map((f) => (f.includes(' ') ? `"${f}"` : f)).join(', ')

export const applyEditorFont = (s: EditorSettings, root: HTMLElement = document.documentElement): void => {
  root.style.setProperty('--font-mono', cssFontFamily(s.fontFamily))
  root.style.setProperty('--font-size', `${s.fontSize}px`)
}
