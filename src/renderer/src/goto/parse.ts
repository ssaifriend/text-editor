export type GotoMode = 'files' | 'symbols' | 'lines' | 'words'

export type GotoQuery = {
  readonly mode: GotoMode
  readonly file: string
  readonly symbol: string | null
  readonly line: number | null
  readonly col: number | null
  readonly word: string | null
}

const empty: GotoQuery = { mode: 'files', file: '', symbol: null, line: null, col: null, word: null }

const parseLine = (text: string): { line: number | null; col: number | null } => {
  const m = /^(\d+)?(?::(\d+))?$/.exec(text)
  if (!m || (!m[1] && !m[2])) return { line: null, col: null }
  return { line: m[1] ? Number(m[1]) : null, col: m[2] ? Number(m[2]) : null }
}

export const parseGotoQuery = (text: string): GotoQuery => {
  if (text.startsWith('@')) return { ...empty, mode: 'symbols', symbol: text.slice(1) }
  if (text.startsWith('#')) return { ...empty, mode: 'words', word: text.slice(1) }
  if (text.startsWith(':')) return { ...empty, mode: 'lines', ...parseLine(text.slice(1)) }

  const at = text.indexOf('@')
  if (at >= 0) return { ...empty, file: text.slice(0, at), symbol: text.slice(at + 1) }
  const colon = text.indexOf(':')
  if (colon >= 0) return { ...empty, file: text.slice(0, colon), ...parseLine(text.slice(colon + 1)) }
  return { ...empty, file: text }
}
