import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { languageById } from '@renderer/editor/lang'
import { symbolsOf, wordsOf } from '@renderer/goto/symbols'

const stateFor = (doc: string, languageId: string) => EditorState.create({ doc, extensions: languageById(languageId).load() })

describe('symbolsOf', () => {
  it('finds TypeScript functions, classes, methods and top-level consts', () => {
    const doc = `export const alpha = 1\nfunction beta() {}\nclass Gamma {\n  delta() {}\n}\nconst epsilon = () => 2\n`
    const names = symbolsOf(stateFor(doc, 'typescript'), 'typescript').map((s) => s.name)
    expect(names).toEqual(['alpha', 'beta', 'Gamma', 'delta', 'epsilon'])
  })

  it('finds markdown headings', () => {
    const doc = '# Title\n\ntext\n\n## Second\n### Third\n'
    expect(symbolsOf(stateFor(doc, 'markdown'), 'markdown').map((s) => s.name)).toEqual(['Title', 'Second', 'Third'])
  })

  it('finds python defs and classes', () => {
    const doc = 'def foo():\n    pass\n\nclass Bar:\n    def baz(self):\n        pass\n'
    expect(symbolsOf(stateFor(doc, 'python'), 'python').map((s) => s.name)).toEqual(['foo', 'Bar', 'baz'])
  })
})

describe('wordsOf', () => {
  it('lists unique words of 3+ characters in first-occurrence order', () => {
    const words = wordsOf(EditorState.create({ doc: 'the cat sat on the mat 한글 단어 cat\n' }))
    expect(words.map((w) => w.word)).toEqual(['the', 'cat', 'sat', 'mat', '한글', '단어'])
    expect(words[1]?.from).toBe(4)
  })
})
