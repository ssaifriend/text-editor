import { foldable } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, it, expect } from 'vitest'
import { languageById } from '@renderer/editor/lang'
import { markdownExtensions, urlFromPaste } from '@renderer/markdown/extension'

const state = (doc: string) => EditorState.create({ doc, extensions: [languageById('markdown').load(), markdownExtensions({ linkOnPaste: () => true })] })

describe('heading folding', () => {
  it('folds a section up to the next heading of the same or higher level', () => {
    const s = state('# A\nline\n## B\nmore\n# C\nend')
    const a = s.doc.line(1)
    expect(foldable(s, a.from, a.to)).toEqual({ from: a.to, to: s.doc.line(4).to })
    const b = s.doc.line(3)
    expect(foldable(s, b.from, b.to)).toEqual({ from: b.to, to: s.doc.line(4).to })
    expect(foldable(s, s.doc.line(2).from, s.doc.line(2).to)).toBeNull()
  })

  it('folds the last section to the end of the document and ignores single-line sections', () => {
    const s = state('# A\n# B\ntail')
    expect(foldable(s, s.doc.line(1).from, s.doc.line(1).to)).toBeNull()
    expect(foldable(s, s.doc.line(2).from, s.doc.line(2).to)).toEqual({ from: s.doc.line(2).to, to: s.doc.length })
  })
})

describe('urlFromPaste', () => {
  it('accepts a single http(s) url and rejects anything else', () => {
    expect(urlFromPaste('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(urlFromPaste(' http://x.y \n')).toBe('http://x.y')
    expect(urlFromPaste('see https://x.y')).toBeNull()
    expect(urlFromPaste('ftp://x.y')).toBeNull()
  })
})
