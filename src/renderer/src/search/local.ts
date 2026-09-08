import type { EditorState } from '@codemirror/state'
import { matchesInLine, toRegExp } from '@shared/replaceText'
import type { SearchMatch, SearchSpec } from '@shared/search'

export const searchState = (spec: SearchSpec, path: string, state: EditorState, cap = 10_000): SearchMatch[] => {
  const re = toRegExp(spec)
  if (!re) return []

  const out: SearchMatch[] = []
  for (let n = 1; n <= state.doc.lines && out.length < cap; n++) {
    const line = state.doc.line(n)
    for (const hit of matchesInLine(line.text, re)) out.push({ path, line: n, text: line.text, from: hit.from, to: hit.to })
  }
  return out
}
