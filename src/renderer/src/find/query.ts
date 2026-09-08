import { SearchQuery } from '@codemirror/search'
import type { EditorState, SelectionRange } from '@codemirror/state'
import type { FindSpec } from './state'

export type Match = { readonly from: number; readonly to: number }

export const buildQuery = (spec: FindSpec, ranges: readonly SelectionRange[] | null): SearchQuery =>
  new SearchQuery({
    search: spec.search,
    replace: spec.replace,
    regexp: spec.regexp,
    caseSensitive: spec.caseSensitive,
    wholeWord: spec.wholeWord,
    test: spec.inSelection && ranges ? (_m, _s, from, to) => ranges.some((r) => from >= r.from && to <= r.to) : undefined,
  })

export const matchesOf = (query: SearchQuery, state: EditorState, cap = 10_000): Match[] => {
  if (!query.valid) return []
  const out: Match[] = []
  const cursor = query.getCursor(state)
  for (let step = cursor.next(); !step.done && out.length < cap; step = cursor.next()) {
    out.push({ from: step.value.from, to: step.value.to })
  }
  return out
}

export const countMatches = (query: SearchQuery, state: EditorState, cap = 10_000): { count: number; capped: boolean } => {
  const found = matchesOf(query, state, cap)
  return { count: found.length, capped: found.length >= cap }
}

export const currentMatchIndex = (query: SearchQuery, state: EditorState, cap = 10_000): number | null => {
  const { from, to } = state.selection.main
  const index = matchesOf(query, state, cap).findIndex((m) => m.from === from && m.to === to)
  return index >= 0 ? index + 1 : null
}
