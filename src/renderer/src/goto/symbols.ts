import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

export type SymbolEntry = { readonly name: string; readonly from: number; readonly kind: string }

type Rule = { readonly container: RegExp; readonly nameNode: RegExp }

const rules: Record<string, readonly Rule[]> = {
  typescript: [
    {
      container:
        /^(FunctionDeclaration|ClassDeclaration|MethodDeclaration|VariableDeclaration|TypeAliasDeclaration|InterfaceDeclaration|EnumDeclaration)$/,
      nameNode: /^(VariableDefinition|PropertyDefinition|TypeDefinition)$/,
    },
  ],
  python: [{ container: /^(FunctionDefinition|ClassDefinition)$/, nameNode: /^VariableName$/ }],
  rust: [
    { container: /^(FunctionItem|StructItem|EnumItem|TraitItem|TypeItem)$/, nameNode: /^(BoundIdentifier|TypeIdentifier)$/ },
  ],
  go: [{ container: /^(FunctionDecl|MethodDecl|TypeSpec)$/, nameNode: /^(DefName|TypeName)$/ }],
  markdown: [{ container: /^(ATXHeading[1-6]|SetextHeading[12])$/, nameNode: /^$/ }],
}

const aliases: Record<string, string> = { tsx: 'typescript', javascript: 'typescript', jsx: 'typescript' }

const findName = (node: SyntaxNode, pattern: RegExp, depth = 0): SyntaxNode | null => {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (pattern.test(child.name)) return child
    if (depth < 2 && /^(VariableDeclaration|Pattern|ArrowFunction)$/.test(child.name) === false) {
      const inner = child.name.endsWith('Definition') || child.name.endsWith('Name') ? null : findName(child, pattern, depth + 1)
      if (inner) return inner
    }
  }
  return null
}

const headingText = (state: EditorState, node: SyntaxNode): string =>
  state
    .sliceDoc(node.from, node.to)
    .replace(/^#+\s*/, '')
    .replace(/\n[-=]+\s*$/, '')
    .trim()

export const symbolsOf = (state: EditorState, languageId: string): SymbolEntry[] => {
  const tree = ensureSyntaxTree(state, state.doc.length, 500)
  const active = rules[aliases[languageId] ?? languageId]
  if (!tree || !active) return []

  const out: SymbolEntry[] = []
  tree.iterate({
    enter: (ref) => {
      const rule = active.find((r) => r.container.test(ref.name))
      if (!rule) return undefined

      const node = ref.node
      if (rule.nameNode.source === '^$') {
        out.push({ name: headingText(state, node), from: node.from, kind: ref.name })
        return false
      }

      const nameNode = findName(node, rule.nameNode)
      if (nameNode) out.push({ name: state.sliceDoc(nameNode.from, nameNode.to), from: nameNode.from, kind: ref.name })
      return undefined
    },
  })
  return out
}

export const wordsOf = (state: EditorState, limit = 5000): { word: string; from: number }[] => {
  const seen: Record<string, true> = {}
  const out: { word: string; from: number }[] = []
  const text = state.doc.toString()
  for (const m of text.matchAll(/[\p{L}_][\p{L}\p{N}_]+/gu)) {
    const word = m[0]
    if (seen[word] || (word.length < 3 && /^[\x00-\x7f]+$/.test(word))) continue
    seen[word] = true
    out.push({ word, from: m.index ?? 0 })
    if (out.length >= limit) break
  }
  return out
}
