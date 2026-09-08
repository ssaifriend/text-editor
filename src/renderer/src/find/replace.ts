import type { SearchQuery } from '@codemirror/search'
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import { matchesOf } from './query'
import { preserveCaseOf } from './state'

const replacementFor = (query: SearchQuery, state: EditorState, from: number, to: number, preserveCase: boolean): string => {
  const matched = state.sliceDoc(from, to)
  const base = query.regexp
    ? matched.replace(new RegExp(query.search, query.caseSensitive ? 'u' : 'iu'), query.replace)
    : query.replace
  return preserveCase ? preserveCaseOf(matched, base) : base
}

export const replaceAllPreserving = (state: EditorState, query: SearchQuery, preserveCase = true): TransactionSpec | null => {
  const matches = matchesOf(query, state)
  if (matches.length === 0) return null

  return {
    changes: matches.map((m) => ({ from: m.from, to: m.to, insert: replacementFor(query, state, m.from, m.to, preserveCase) })),
    userEvent: 'input.replace.all',
  }
}

export const replaceNextPreserving = (state: EditorState, query: SearchQuery, preserveCase = true): TransactionSpec | null => {
  const matches = matchesOf(query, state)
  if (matches.length === 0) return null

  const main = state.selection.main
  const at = matches.find((m) => m.from === main.from && m.to === main.to) ?? matches.find((m) => m.from >= main.to) ?? matches[0]
  if (!at) return null

  const insert = replacementFor(query, state, at.from, at.to, preserveCase)
  const delta = insert.length - (at.to - at.from)
  const following = matches.find((m) => m.from > at.from) ?? matches.find((m) => m.from < at.from)
  const shift = following && following.from > at.from ? delta : 0
  const selection = following
    ? EditorSelection.single(following.from + shift, following.to + shift)
    : EditorSelection.cursor(at.from + insert.length)

  return { changes: { from: at.from, to: at.to, insert }, selection, scrollIntoView: true, userEvent: 'input.replace' }
}
