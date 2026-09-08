import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { describe, it, expect } from 'vitest'
import { alignTable, renumberList, shiftHeading, toggleCheckbox, toggleWrap, wrapSelectionAsLink } from '@renderer/markdown/commands'

const st = (doc: string, anchor: number, head = anchor) => EditorState.create({ doc, selection: EditorSelection.single(anchor, head) })
const apply = (state: EditorState, spec: TransactionSpec | null) => {
  if (!spec) throw new Error('null spec')
  const tr = state.update(spec)
  return { doc: tr.state.doc.toString(), sel: tr.state.selection.main }
}

describe('toggleWrap', () => {
  it('wraps and unwraps a selection', () => {
    const a = apply(st('hello 한글', 6, 8), toggleWrap(st('hello 한글', 6, 8), '**'))
    expect(a.doc).toBe('hello **한글**')
    expect([a.sel.from, a.sel.to]).toEqual([8, 10])
    const b = apply(st(a.doc, 8, 10), toggleWrap(st(a.doc, 8, 10), '**'))
    expect(b.doc).toBe('hello 한글')
  })

  it('wraps the word at an empty cursor, else inserts an empty pair', () => {
    expect(apply(st('foo bar', 5), toggleWrap(st('foo bar', 5), '*')).doc).toBe('foo *bar*')
    const e = apply(st('foo ', 4), toggleWrap(st('foo ', 4), '`'))
    expect(e.doc).toBe('foo ``')
    expect(e.sel.from).toBe(5)
  })
})

describe('toggleCheckbox', () => {
  it('cycles unchecked → checked → unchecked and adds a box to plain items', () => {
    const doc = '- [ ] a\n- [x] b\n- c'
    expect(apply(st(doc, 0, 18), toggleCheckbox(st(doc, 0, 18))).doc).toBe('- [x] a\n- [ ] b\n- [ ] c')
    expect(toggleCheckbox(st('plain', 0))).toBeNull()
  })
})

describe('shiftHeading', () => {
  it('adds, raises, lowers and removes heading markers', () => {
    expect(apply(st('title', 0), shiftHeading(st('title', 0), 1)).doc).toBe('# title')
    expect(apply(st('## title', 0), shiftHeading(st('## title', 0), 1)).doc).toBe('### title')
    expect(apply(st('# title', 0), shiftHeading(st('# title', 0), -1)).doc).toBe('title')
    expect(shiftHeading(st('###### t', 0), 1)).toBeNull()
  })
})

describe('renumberList', () => {
  it('renumbers the ordered list around the cursor, preserving indentation', () => {
    const doc = '3. a\n7. b\n  1. x\n  1. y\n9. c\n\ntext'
    expect(apply(st(doc, 6), renumberList(st(doc, 6))).doc).toBe('1. a\n2. b\n  1. x\n  2. y\n3. c\n\ntext')
    expect(renumberList(st('plain', 0))).toBeNull()
  })
})

describe('alignTable', () => {
  it('formats the table block containing the cursor', () => {
    const doc = 'before\n|a|b|\n|--|--|\n|한글|1|\nafter'
    expect(apply(st(doc, 10), alignTable(st(doc, 10))).doc).toBe('before\n| a    | b   |\n|------|-----|\n| 한글 | 1   |\nafter')
    expect(alignTable(st(doc, 0))).toBeNull()
  })
})

describe('wrapSelectionAsLink', () => {
  it('wraps a single-line selection', () => {
    expect(apply(st('see docs now', 4, 8), wrapSelectionAsLink(st('see docs now', 4, 8), 'https://x.y')).doc).toBe('see [docs](https://x.y) now')
    expect(wrapSelectionAsLink(st('a\nb', 0, 3), 'https://x.y')).toBeNull()
  })
})
