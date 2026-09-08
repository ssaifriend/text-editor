import type { SearchMatch } from '@shared/search'

export type RgEvent =
  | { kind: 'match'; matches: SearchMatch[] }
  | { kind: 'end'; path: string }
  | { kind: 'summary'; matched: number }
  | { kind: 'other' }

export const byteToCharOffset = (text: string, byteOffset: number): number => {
  const bytes = Buffer.from(text, 'utf8')
  return bytes.subarray(0, Math.min(byteOffset, bytes.length)).toString('utf8').length
}

type RgMatch = {
  path?: { text?: string }
  lines?: { text?: string }
  line_number?: number
  submatches?: { start: number; end: number }[]
}

const stripTerminator = (line: string): string => line.replace(/\r?\n$/, '')

const parseMatch = (data: RgMatch): RgEvent => {
  const path = data.path?.text
  const raw = data.lines?.text
  const lineNumber = data.line_number
  if (typeof path !== 'string' || typeof raw !== 'string' || typeof lineNumber !== 'number') return { kind: 'other' }

  const text = stripTerminator(raw)
  const matches = (data.submatches ?? []).map((s) => ({
    path,
    line: lineNumber,
    text,
    from: byteToCharOffset(raw, s.start),
    to: byteToCharOffset(raw, s.end),
  }))
  return { kind: 'match', matches }
}

export const parseRgLine = (line: string): RgEvent => {
  let parsed: { type?: string; data?: Record<string, unknown> }
  try {
    parsed = JSON.parse(line) as { type?: string; data?: Record<string, unknown> }
  } catch {
    return { kind: 'other' }
  }
  const data = parsed.data
  if (!data || typeof data !== 'object') return { kind: 'other' }

  if (parsed.type === 'match') return parseMatch(data as RgMatch)
  if (parsed.type === 'end') {
    const path = (data['path'] as { text?: string } | undefined)?.text
    return typeof path === 'string' ? { kind: 'end', path } : { kind: 'other' }
  }
  if (parsed.type === 'summary') {
    const matched = (data['stats'] as { matches?: number } | undefined)?.matches ?? 0
    return { kind: 'summary', matched }
  }
  return { kind: 'other' }
}
