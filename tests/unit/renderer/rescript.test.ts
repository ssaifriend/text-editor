import { StreamLanguage, ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, it, expect } from 'vitest'
import { languageFor } from '@renderer/editor/lang'
import { rescript } from '@renderer/editor/rescript'

const tokensOf = (doc: string): string[] => {
  const state = EditorState.create({ doc, extensions: [StreamLanguage.define(rescript)] })
  const tree = ensureSyntaxTree(state, doc.length, 1000)!
  const out: string[] = []
  tree.iterate({ enter: (n) => void (n.node.firstChild === null && n.name !== 'Document' && out.push(`${n.name}:${doc.slice(n.from, n.to)}`)) })
  return out
}

describe('rescript mode', () => {
  it('maps .res/.resi and .clj family to languages', () => {
    expect(languageFor('/a/App.res').id).toBe('rescript')
    expect(languageFor('/a/App.resi').id).toBe('rescript')
    expect(languageFor('/a/core.cljs').id).toBe('clojure')
    expect(languageFor('/a/deps.edn').id).toBe('clojure')
  })

  it('tokenizes keywords, strings, comments, decorators, variants and types', () => {
    const toks = tokensOf('@react.component\nlet make = (~name: string) => { // hi\n  switch x { | #Tag => "s" | Some(v) => 1.5 }\n}\n/* a /* nested */ b */ type t<\'a> = option<\'a>')
    expect(toks).toContain('meta:@react.component')
    expect(toks).toContain('keyword:let')
    expect(toks).toContain('keyword:switch')
    expect(toks).toContain('comment:// hi')
    expect(toks).toContain('atom:#Tag')
    expect(toks).toContain('string:"s"')
    expect(toks).toContain('atom:Some')
    expect(toks).toContain('number:1.5')
    expect(toks).toContain("comment:/* a /* nested */ b */")
    expect(toks).toContain("typeName:'a")
    expect(toks).toContain('typeName:option')
    expect(toks).toContain('typeName:string')
  })
})
