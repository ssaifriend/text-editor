export type Indent = { readonly insertSpaces: boolean; readonly tabSize: number }

const candidateWidths = [2, 3, 4, 8] as const

const leadingOf = (line: string): { tabs: number; spaces: number } | null => {
  const m = /^([\t ]*)\S/.exec(line)
  if (!m) return null
  const lead = m[1]!
  return { tabs: (lead.match(/\t/g) ?? []).length, spaces: (lead.match(/ /g) ?? []).length }
}

export const detectIndent = (text: string, sampleLines = 2000): Indent | null => {
  const leads = text
    .split('\n', sampleLines)
    .map(leadingOf)
    .filter((l): l is { tabs: number; spaces: number } => l !== null)

  const tabLines = leads.filter((l) => l.tabs > 0 && l.spaces === 0).length
  const spaceLines = leads.filter((l) => l.spaces > 0 && l.tabs === 0)
  if (tabLines + spaceLines.length < 2) return null
  if (tabLines >= spaceLines.length) return { insertSpaces: false, tabSize: 4 }

  const deltas: Record<number, number> = {}
  let previous = 0
  for (const l of leads) {
    if (l.tabs > 0) continue
    const delta = Math.abs(l.spaces - previous)
    if (delta > 0) deltas[delta] = (deltas[delta] ?? 0) + 1
    previous = l.spaces
  }

  const best = candidateWidths
    .map((w) => ({ w, count: deltas[w] ?? 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.w - b.w)[0]
  if (best) return { insertSpaces: true, tabSize: best.w }

  const smallest = Math.min(...spaceLines.map((l) => l.spaces))
  return { insertSpaces: true, tabSize: Number.isFinite(smallest) && smallest > 0 ? smallest : 4 }
}
