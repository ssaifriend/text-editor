import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import type { Command } from '@codemirror/view'
import { formatTable, isTableLine } from './table'

export type Marker = '**' | '*' | '`'

type LineEdit = { readonly from: number; readonly to: number; readonly insert: string }

const linesOfRange = (state: EditorState, from: number, to: number): number[] => {
  const first = state.doc.lineAt(from).number
  const last = state.doc.lineAt(to).number
  return Array.from({ length: last - first + 1 }, (_, i) => first + i)
}

const linesOfSelection = (state: EditorState): number[] =>
  [...new Set(state.selection.ranges.flatMap((r) => linesOfRange(state, r.from, r.to)))].sort((a, b) => a - b)

const editLines = (state: EditorState, lines: readonly number[], edit: (text: string) => string | null): TransactionSpec | null => {
  const changes: LineEdit[] = lines.flatMap((n) => {
    const line = state.doc.line(n)
    const next = edit(line.text)
    return next === null || next === line.text ? [] : [{ from: line.from, to: line.to, insert: next }]
  })
  return changes.length === 0 ? null : { changes, scrollIntoView: true }
}

export const toggleWrap = (state: EditorState, marker: Marker): TransactionSpec | null =>
  state.changeByRange((range) => {
    const target = range.empty ? state.wordAt(range.head) : range
    if (!target) {
      return { changes: { from: range.head, insert: marker + marker }, range: EditorSelection.cursor(range.head + marker.length) }
    }

    const text = state.sliceDoc(target.from, target.to)
    const before = state.sliceDoc(Math.max(0, target.from - marker.length), target.from)
    const after = state.sliceDoc(target.to, target.to + marker.length)
    if (before === marker && after === marker) {
      return {
        changes: [
          { from: target.from - marker.length, to: target.from },
          { from: target.to, to: target.to + marker.length },
        ],
        range: EditorSelection.range(target.from - marker.length, target.to - marker.length),
      }
    }
    if (text.length >= marker.length * 2 && text.startsWith(marker) && text.endsWith(marker)) {
      return {
        changes: { from: target.from, to: target.to, insert: text.slice(marker.length, -marker.length) },
        range: EditorSelection.range(target.from, target.to - marker.length * 2),
      }
    }
    return {
      changes: [
        { from: target.from, insert: marker },
        { from: target.to, insert: marker },
      ],
      range: EditorSelection.range(target.from + marker.length, target.to + marker.length),
    }
  })

export const toggleCheckbox = (state: EditorState): TransactionSpec | null =>
  editLines(state, linesOfSelection(state), (text) => {
    const boxed = /^(\s*[-*+]\s+)\[( |x|X)\](\s.*)?$/.exec(text)
    if (boxed) return `${boxed[1]}[${boxed[2] === ' ' ? 'x' : ' '}]${boxed[3] ?? ''}`
    const plain = /^(\s*[-*+]\s+)(?!\[[ xX]\])(.*)$/.exec(text)
    return plain ? `${plain[1]}[ ] ${plain[2]}` : null
  })

export const shiftHeading = (state: EditorState, delta: 1 | -1): TransactionSpec | null =>
  editLines(state, linesOfSelection(state), (text) => {
    const m = /^(#{0,6})(\s?)(.*)$/.exec(text)
    if (!m) return null
    const level = m[1]!.length
    const next = level + delta
    if (next < 0 || next > 6) return null
    return next === 0 ? m[3]! : `${'#'.repeat(next)} ${m[3]!}`
  })

const orderedItem = /^(\s*)(\d+)([.)])(\s+)(.*)$/

export const renumberList = (state: EditorState): TransactionSpec | null => {
  const blocks = new Set<number>()
  for (const n of linesOfSelection(state)) {
    if (!orderedItem.test(state.doc.line(n).text)) continue
    let start = n
    while (start > 1 && orderedItem.test(state.doc.line(start - 1).text)) start -= 1
    let end = n
    while (end < state.doc.lines && orderedItem.test(state.doc.line(end + 1).text)) end += 1
    for (let i = start; i <= end; i++) blocks.add(i)
  }
  if (blocks.size === 0) return null

  const counters: Record<number, number> = {}
  let previousIndent = -1
  const numbered: Record<number, string> = {}
  for (const n of [...blocks].sort((a, b) => a - b)) {
    const m = orderedItem.exec(state.doc.line(n).text)!
    const indent = m[1]!.length
    if (indent < previousIndent) Object.keys(counters).forEach((k) => Number(k) > indent && delete counters[Number(k)])
    counters[indent] = (counters[indent] ?? 0) + 1
    previousIndent = indent
    numbered[n] = `${m[1]}${counters[indent]}${m[3]}${m[4]}${m[5]}`
  }
  return editLines(state, [...blocks], (text) => {
    const n = blocks.size > 0 ? [...blocks].find((i) => state.doc.line(i).text === text) : undefined
    return n === undefined ? null : numbered[n]!
  })
}

export const alignTable = (state: EditorState): TransactionSpec | null => {
  const cursorLine = state.doc.lineAt(state.selection.main.head).number
  if (!isTableLine(state.doc.line(cursorLine).text)) return null

  let start = cursorLine
  while (start > 1 && isTableLine(state.doc.line(start - 1).text)) start -= 1
  let end = cursorLine
  while (end < state.doc.lines && isTableLine(state.doc.line(end + 1).text)) end += 1

  const lines = Array.from({ length: end - start + 1 }, (_, i) => state.doc.line(start + i).text)
  const formatted = formatTable(lines).join('\n')
  const from = state.doc.line(start).from
  const to = state.doc.line(end).to
  return formatted === state.sliceDoc(from, to) ? null : { changes: { from, to, insert: formatted } }
}

export const wrapSelectionAsLink = (state: EditorState, url: string): TransactionSpec | null => {
  const range = state.selection.main
  if (range.empty || state.selection.ranges.length > 1) return null
  const text = state.sliceDoc(range.from, range.to)
  if (text.includes('\n')) return null
  const insert = `[${text}](${url})`
  return { changes: { from: range.from, to: range.to, insert }, selection: EditorSelection.single(range.from + insert.length) }
}

const command =
  (fn: (state: EditorState) => TransactionSpec | null): Command =>
  (view) => {
    const spec = fn(view.state)
    if (!spec) return false
    view.dispatch(spec, { userEvent: 'input' })
    return true
  }

export const markdownCommands: readonly { readonly id: string; readonly title: string; readonly run: Command }[] = [
  { id: 'markdown.bold', title: 'Markdown: Toggle Bold', run: command((s) => toggleWrap(s, '**')) },
  { id: 'markdown.italic', title: 'Markdown: Toggle Italic', run: command((s) => toggleWrap(s, '*')) },
  { id: 'markdown.code', title: 'Markdown: Toggle Inline Code', run: command((s) => toggleWrap(s, '`')) },
  { id: 'markdown.toggleCheckbox', title: 'Markdown: Toggle Checkbox', run: command(toggleCheckbox) },
  { id: 'markdown.headingUp', title: 'Markdown: Increase Heading Level', run: command((s) => shiftHeading(s, 1)) },
  { id: 'markdown.headingDown', title: 'Markdown: Decrease Heading Level', run: command((s) => shiftHeading(s, -1)) },
  { id: 'markdown.alignTable', title: 'Markdown: Align Table', run: command(alignTable) },
  { id: 'markdown.renumberList', title: 'Markdown: Renumber List', run: command(renumberList) },
]
