import { A, D } from '@mobily/ts-belt'
import type { EditorState } from '@codemirror/state'
import { expandReplacement, matchesInLine, preserveCaseOf, toRegExp } from '@shared/replaceText'
import type { ReplacePlan, SearchMatch, SearchSpec } from '@shared/search'

export type SearchStatus = 'idle' | 'running' | 'done' | 'error'

export type FileResult = { readonly path: string; readonly matches: readonly SearchMatch[]; readonly source: 'disk' | 'buffer' }

export type SearchState = {
  readonly id: string
  readonly spec: SearchSpec
  readonly replacement: string
  readonly preserveCase: boolean
  readonly status: SearchStatus
  readonly error: string | null
  readonly files: readonly FileResult[]
  readonly total: number
  readonly truncated: boolean
  readonly excluded: Readonly<Record<string, true>>
  readonly collapsed: Readonly<Record<string, true>>
}

export type Edit = { readonly from: number; readonly to: number; readonly insert: string }

export const defaultSearchSpec: SearchSpec = { pattern: '', regexp: false, caseSensitive: false, wholeWord: false, include: '', exclude: '' }

export const emptySearch = (id: string, spec: Partial<SearchSpec> = {}): SearchState => ({
  id,
  spec: { ...defaultSearchSpec, ...spec },
  replacement: '',
  preserveCase: false,
  status: 'idle',
  error: null,
  files: [],
  total: 0,
  truncated: false,
  excluded: {},
  collapsed: {},
})

const recount = (s: SearchState): SearchState => ({ ...s, total: s.files.reduce((n, f) => n + f.matches.length, 0) })

export const appendBatch = (s: SearchState, matches: readonly SearchMatch[]): SearchState => {
  const files = [...s.files]
  const indexOf: Record<string, number> = Object.fromEntries(files.map((f, i) => [f.path, i]))

  for (const m of matches) {
    const at = indexOf[m.path]
    const existing = at === undefined ? undefined : files[at]
    if (!existing) {
      indexOf[m.path] = files.length
      files.push({ path: m.path, matches: [m], source: 'disk' })
    } else if (existing.source === 'disk') {
      files[at!] = { ...existing, matches: [...existing.matches, m] }
    }
  }
  return recount({ ...s, files })
}

export const replaceFileResults = (s: SearchState, path: string, matches: readonly SearchMatch[]): SearchState => {
  const at = s.files.findIndex((f) => f.path === path)
  const without = s.files.filter((f) => f.path !== path)
  if (matches.length === 0) return recount({ ...s, files: without })

  const entry: FileResult = { path, matches, source: 'buffer' }
  const files = at < 0 ? [...without, entry] : [...s.files.slice(0, at), entry, ...s.files.slice(at + 1)]
  return recount({ ...s, files })
}

export const matchKey = (m: SearchMatch, index: number): string => `${m.path}:${m.line}:${index}`

export const toggleExcluded = (s: SearchState, key: string): SearchState => ({
  ...s,
  excluded: s.excluded[key] ? D.deleteKey(s.excluded, key) : { ...s.excluded, [key]: true },
})

export const toggleCollapsed = (s: SearchState, path: string): SearchState => ({
  ...s,
  collapsed: s.collapsed[path] ? D.deleteKey(s.collapsed, path) : { ...s.collapsed, [path]: true },
})

export const isIncluded = (s: SearchState, m: SearchMatch, index: number): boolean => !s.excluded[m.path] && !s.excluded[matchKey(m, index)]

export const ordinalIn = (file: FileResult, m: SearchMatch): number => file.matches.filter((x) => x.line === m.line && x.from < m.from).length

export const previewOf = (s: SearchState, m: SearchMatch): string | null => {
  if (s.replacement === '') return null
  const re = toRegExp(s.spec)
  if (!re) return null

  const hit = matchesInLine(m.text, re).find((h) => h.from === m.from)
  if (!hit) return null
  const expanded = expandReplacement(hit.exec, s.replacement, s.spec.regexp)
  return s.preserveCase ? preserveCaseOf(hit.exec[0], expanded) : expanded
}

const includedMatches = (s: SearchState, file: FileResult): { m: SearchMatch; index: number }[] =>
  file.matches.map((m) => ({ m, index: ordinalIn(file, m) })).filter(({ m, index }) => isIncluded(s, m, index))

export const includedCount = (s: SearchState): { files: number; matches: number } => {
  const perFile = s.files.map((f) => includedMatches(s, f).length).filter((n) => n > 0)
  return { files: perFile.length, matches: A.reduce(perFile, 0, (a, b) => a + b) }
}

const skippedOrdinals = (s: SearchState, file: FileResult, line: number): number[] =>
  file.matches
    .filter((m) => m.line === line)
    .map((m) => ordinalIn(file, m))
    .filter((index) => {
      const m = file.matches.find((x) => x.line === line && ordinalIn(file, x) === index)
      return m ? !isIncluded(s, m, index) : false
    })

export const planFor = (s: SearchState, hashes: Readonly<Record<string, string>>): ReplacePlan => ({
  spec: s.spec,
  replacement: s.replacement,
  preserveCase: s.preserveCase,
  files: s.files
    .filter((f) => hashes[f.path] !== undefined && includedMatches(s, f).length > 0)
    .map((f) => ({
      path: f.path,
      hash: hashes[f.path]!,
      lines: A.uniq(f.matches.map((m) => m.line)).map((line) => ({ line, skip: skippedOrdinals(s, f, line) })),
    })),
})

export const bufferEdits = (s: SearchState, path: string, state: EditorState): Edit[] => {
  const file = s.files.find((f) => f.path === path)
  if (!file) return []

  return includedMatches(s, file).flatMap(({ m }) => {
    const insert = previewOf(s, m)
    if (insert === null || m.line > state.doc.lines) return []
    const base = state.doc.line(m.line).from
    return [{ from: base + m.from, to: base + m.to, insert }]
  })
}
