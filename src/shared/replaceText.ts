export type MatchSpec = {
  readonly pattern: string
  readonly regexp: boolean
  readonly caseSensitive: boolean
  readonly wholeWord: boolean
}

export type LineEdit = { readonly from: number; readonly to: number; readonly insert: string }
export type LineMatch = { readonly from: number; readonly to: number; readonly exec: RegExpExecArray }

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

export const toRegExp = (spec: MatchSpec): RegExp | null => {
  if (spec.pattern === '') return null
  const body = spec.regexp ? spec.pattern : escapeRegExp(spec.pattern)
  const source = spec.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])` : body
  try {
    return new RegExp(source, spec.caseSensitive ? 'gu' : 'giu')
  } catch {
    return null
  }
}

const isUpper = (s: string): boolean => s === s.toUpperCase() && s !== s.toLowerCase()
const isLower = (s: string): boolean => s === s.toLowerCase() && s !== s.toUpperCase()
const isCapitalized = (s: string): boolean =>
  s.length > 1 && isUpper(s.charAt(0)) && s.slice(1) === s.slice(1).toLowerCase()

export const preserveCaseOf = (sample: string, replacement: string): string => {
  if (isUpper(sample)) return replacement.toUpperCase()
  if (isCapitalized(sample)) return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase()
  if (isLower(sample)) return replacement.toLowerCase()
  return replacement
}

export const expandReplacement = (m: RegExpExecArray, template: string, regexp: boolean): string => {
  if (!regexp) return template
  return template.replace(/\$\$|\$(\d+)|\$<([^>]+)>|\\n|\\t/g, (token, index: string | undefined, name: string | undefined) => {
    if (token === '$$') return '$'
    if (token === '\\n') return '\n'
    if (token === '\\t') return '\t'
    if (index !== undefined) return m[Number(index)] ?? ''
    return m.groups?.[name ?? ''] ?? ''
  })
}

export const matchesInLine = (line: string, re: RegExp): LineMatch[] => {
  const out: LineMatch[] = []
  re.lastIndex = 0
  for (let m = re.exec(line); m !== null; m = re.exec(line)) {
    out.push({ from: m.index, to: m.index + m[0].length, exec: m })
    if (m[0] === '') re.lastIndex = m.index + 1
    if (re.lastIndex > line.length) break
  }
  return out
}

export const replaceInLine = (
  line: string,
  spec: MatchSpec,
  replacement: string,
  preserveCase: boolean,
  skip: readonly number[] = [],
): { text: string; edits: LineEdit[] } | null => {
  const re = toRegExp(spec)
  if (!re) return null

  const edits = matchesInLine(line, re)
    .filter((_, i) => !skip.includes(i))
    .map(({ from, to, exec }) => {
      const expanded = expandReplacement(exec, replacement, spec.regexp)
      return { from, to, insert: preserveCase ? preserveCaseOf(exec[0], expanded) : expanded }
    })
  if (edits.length === 0) return null

  const text = edits.reduceRight((acc, e) => acc.slice(0, e.from) + e.insert + acc.slice(e.to), line)
  return { text, edits }
}
