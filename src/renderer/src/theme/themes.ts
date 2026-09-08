import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { A, O, pipe } from '@mobily/ts-belt'
import type { UserTheme } from '@shared/theme'

export type Theme = {
  readonly id: string
  readonly dark: boolean
  readonly vars: Record<string, string>
  readonly editor: Extension
  readonly palette: Palette
}

export type Palette = {
  readonly bg: string
  readonly fg: string
  readonly bar: string
  readonly border: string
  readonly selection: string
  readonly cursor: string
  readonly activeLine: string
  readonly gutter: string
  readonly keyword: string
  readonly string: string
  readonly comment: string
  readonly number: string
  readonly fn: string
  readonly type: string
  readonly variable: string
  readonly operator: string
  readonly heading: string
  readonly link: string
}

const build = (id: string, dark: boolean, p: Palette): Theme => ({
  id,
  dark,
  palette: p,
  vars: { '--bg': p.bg, '--fg': p.fg, '--bar': p.bar, '--border': p.border, '--selection': p.selection },
  editor: [
    EditorView.theme(
      {
        '&': { backgroundColor: p.bg, color: p.fg },
        '.cm-content': { caretColor: p.cursor },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: p.cursor },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
          backgroundColor: p.selection,
        },
        '.cm-activeLine': { backgroundColor: p.activeLine },
        '.cm-gutters': { backgroundColor: p.bg, color: p.gutter, borderRight: `1px solid ${p.border}` },
        '.cm-activeLineGutter': { backgroundColor: p.activeLine },
        '.cm-selectionMatch': { backgroundColor: p.selection },
        '.cm-matchingBracket': { outline: `1px solid ${p.gutter}` },
      },
      { dark },
    ),
    syntaxHighlighting(
      HighlightStyle.define([
        {
          tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword],
          color: p.keyword,
        },
        { tag: [t.string, t.special(t.string), t.character], color: p.string },
        { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: p.comment, fontStyle: 'italic' },
        { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom], color: p.number },
        {
          tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))],
          color: p.fn,
        },
        { tag: [t.typeName, t.className, t.namespace, t.tagName], color: p.type },
        { tag: [t.variableName, t.propertyName, t.attributeName, t.definition(t.variableName)], color: p.variable },
        { tag: [t.operator, t.punctuation, t.bracket], color: p.operator },
        { tag: [t.heading, t.heading1, t.heading2, t.heading3], color: p.heading, fontWeight: 'bold' },
        { tag: [t.link, t.url], color: p.link, textDecoration: 'underline' },
        { tag: t.strong, fontWeight: 'bold' },
        { tag: t.emphasis, fontStyle: 'italic' },
        { tag: t.strikethrough, textDecoration: 'line-through' },
        { tag: t.invalid, color: '#ff5f5f' },
      ]),
    ),
  ],
})

export const themes: readonly Theme[] = [
  build('moru-dark', true, {
    bg: '#1e2227',
    fg: '#d5dae0',
    bar: '#2b3038',
    border: '#3d4450',
    selection: '#3a4a5c',
    cursor: '#f9ae58',
    activeLine: '#242930',
    gutter: '#5c6773',
    keyword: '#c695c6',
    string: '#99c794',
    comment: '#a6acb9',
    number: '#f9ae58',
    fn: '#5fb4b4',
    type: '#fac863',
    variable: '#d5dae0',
    operator: '#f97b58',
    heading: '#6699cc',
    link: '#5fb4b4',
  }),
  build('moru-light', false, {
    bg: '#fbfbfb',
    fg: '#24292f',
    bar: '#eef0f3',
    border: '#d0d7de',
    selection: '#c7dcf3',
    cursor: '#0969da',
    activeLine: '#f3f5f8',
    gutter: '#8c959f',
    keyword: '#8250df',
    string: '#0a3069',
    comment: '#6e7781',
    number: '#0550ae',
    fn: '#8250df',
    type: '#953800',
    variable: '#24292f',
    operator: '#cf222e',
    heading: '#0969da',
    link: '#0969da',
  }),
]

let userThemes: readonly Theme[] = []

export const registerUserThemes = (list: readonly UserTheme[]): void => {
  userThemes = list.map((t) => build(t.id, t.dark, t.palette))
}

export const allThemes = (): readonly Theme[] => [...themes, ...userThemes]

export const themeById = (id: string): Theme =>
  pipe(
    allThemes(),
    A.find((th) => th.id === id),
    O.getWithDefault(themes[0] as Theme),
  )
