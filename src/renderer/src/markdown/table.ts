import stringWidth from 'string-width'

type Align = 'left' | 'center' | 'right' | null

export const isTableLine = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line)

const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())

const isAlignRow = (cells: readonly string[]): boolean => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))

const alignOf = (cell: string): Align => {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null
}

const pad = (text: string, width: number, align: Align): string => {
  const gap = Math.max(0, width - stringWidth(text))
  if (align === 'right') return ' '.repeat(gap) + text
  if (align === 'center') return ' '.repeat(Math.floor(gap / 2)) + text + ' '.repeat(gap - Math.floor(gap / 2))
  return text + ' '.repeat(gap)
}

const alignCell = (width: number, align: Align): string => {
  const inner = width + 2
  if (align === 'center') return `:${'-'.repeat(inner - 2)}:`
  if (align === 'right') return `${'-'.repeat(inner - 1)}:`
  if (align === 'left') return `:${'-'.repeat(inner - 1)}`
  return '-'.repeat(inner)
}

export const formatTable = (lines: readonly string[]): string[] => {
  const rows = lines.map(cellsOf)
  const cols = Math.max(...rows.map((r) => r.length))
  const alignRowIndex = rows.findIndex((r, i) => i > 0 && isAlignRow(r))
  const alignRow = alignRowIndex >= 0 ? rows[alignRowIndex]! : []
  const aligns: Align[] = Array.from({ length: cols }, (_, c) => (alignRowIndex >= 0 ? alignOf(alignRow[c] ?? '---') : null))
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(3, ...rows.filter((_, i) => i !== alignRowIndex).map((r) => stringWidth(r[c] ?? ''))),
  )

  return rows.map((row, i) =>
    i === alignRowIndex
      ? `|${widths.map((w, c) => alignCell(w, aligns[c] ?? null)).join('|')}|`
      : `| ${widths.map((w, c) => pad(row[c] ?? '', w, aligns[c] ?? null)).join(' | ')} |`,
  )
}
