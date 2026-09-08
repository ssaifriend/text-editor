import { describe, it, expect } from 'vitest'
import { detectIndent } from '@renderer/editor/indentDetect'

describe('detectIndent', () => {
  it('detects tabs', () => {
    expect(detectIndent('a\n\tb\n\tc\n')).toEqual({ insertSpaces: false, tabSize: 4 })
  })

  it('detects 2- and 4-space indentation from indentation deltas', () => {
    expect(detectIndent('a\n  b\n    c\n  d\n')).toEqual({ insertSpaces: true, tabSize: 2 })
    expect(detectIndent('a\n    b\n        c\n    d\n')).toEqual({ insertSpaces: true, tabSize: 4 })
  })

  it('returns null without enough indented lines and ignores blank lines', () => {
    expect(detectIndent('a\nb\n')).toBeNull()
    expect(detectIndent('a\n\n  \n  b\n')).toBeNull()
  })

  it('prefers tabs when tab-indented lines dominate', () => {
    expect(detectIndent('a\n\tb\n\tc\n  d\n')).toEqual({ insertSpaces: false, tabSize: 4 })
  })

  it('falls back to the smallest indent for unusual widths', () => {
    expect(detectIndent('a\n     b\n     c\n')).toEqual({ insertSpaces: true, tabSize: 5 })
  })
})
