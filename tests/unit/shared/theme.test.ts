import { describe, it, expect } from 'vitest'
import { parseUserTheme } from '../../../src/shared/theme'

const palette = Object.fromEntries(
  ['bg', 'fg', 'bar', 'border', 'selection', 'cursor', 'activeLine', 'gutter', 'keyword', 'string', 'comment', 'number', 'fn', 'type', 'variable', 'operator', 'heading', 'link'].map((k) => [k, '#123456']),
)

describe('parseUserTheme', () => {
  it('accepts a complete theme', () => {
    const r = parseUserTheme(JSON.stringify({ id: 'mine', dark: true, palette }))
    expect(r.ok).toBe(true)
  })

  it('rejects bad ids, missing keys, non-hex colours and invalid JSON', () => {
    expect(parseUserTheme(JSON.stringify({ id: 'Mine!', dark: true, palette })).ok).toBe(false)
    expect(parseUserTheme(JSON.stringify({ id: 'mine', dark: true, palette: { ...palette, bg: undefined } })).ok).toBe(false)
    const bad = parseUserTheme(JSON.stringify({ id: 'mine', dark: false, palette: { ...palette, fg: 'red' } }))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.message).toContain('palette.fg')
    expect(parseUserTheme('{').ok).toBe(false)
  })
})
