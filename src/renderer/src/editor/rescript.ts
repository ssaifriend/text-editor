import type { StreamParser } from '@codemirror/language'

const keywords = new Set([
  'and', 'as', 'assert', 'async', 'await', 'constraint', 'else', 'exception', 'external', 'for', 'if', 'in', 'include',
  'lazy', 'let', 'module', 'mutable', 'of', 'open', 'rec', 'switch', 'try', 'type', 'when', 'while', 'with', 'private', 'unboxed', 'catch',
])
const atoms = new Set(['true', 'false', 'None', 'Some', 'Ok', 'Error', 'list', 'unit'])
const builtinTypes = new Set(['int', 'float', 'string', 'bool', 'option', 'array', 'result', 'promise', 'unit', 'char'])

type State = { blockDepth: number; template: boolean }

const skipBlockComment = (stream: Parameters<StreamParser<State>['token']>[0], state: State): string => {
  while (!stream.eol()) {
    if (stream.match('/*')) state.blockDepth += 1
    else if (stream.match('*/')) {
      state.blockDepth -= 1
      if (state.blockDepth === 0) return 'comment'
    } else stream.next()
  }
  return 'comment'
}

export const rescript: StreamParser<State> = {
  name: 'rescript',
  startState: () => ({ blockDepth: 0, template: false }),
  token: (stream, state) => {
    if (state.blockDepth > 0) return skipBlockComment(stream, state)
    if (stream.eatSpace()) return null

    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      state.blockDepth = 1
      return skipBlockComment(stream, state)
    }
    if (stream.match(/^@@?[\w.]*/)) return 'meta'
    if (stream.match(/^#[A-Za-z_]\w*/)) return 'atom'
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string'
    if (stream.match(/^`(?:[^`\\]|\\.)*`/)) return 'string'
    if (stream.match(/^'(?:[^'\\]|\\.)'/)) return 'string'
    if (stream.match(/^'[a-z_]\w*/)) return 'typeName'
    if (stream.match(/^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/)) return 'number'
    if (stream.match(/^[A-Z]\w*/)) return atoms.has(stream.current()) ? 'atom' : 'typeName'
    if (stream.match(/^[a-z_]\w*/)) {
      const word = stream.current()
      if (keywords.has(word)) return 'keyword'
      if (atoms.has(word)) return 'atom'
      if (builtinTypes.has(word)) return 'typeName'
      if (stream.match(/^(?=\s*\()/, false)) return 'variableName.function'
      return 'variableName'
    }
    if (stream.match(/^(?:->|=>|\|>|\|\||&&|===|!==|==|!=|<=|>=|\.\.\.|\+\+|::|[-+*/%<>=!|&^~?:.,;])/)) return 'operator'
    if (stream.match(/^[()[\]{}]/)) return 'bracket'
    stream.next()
    return null
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{', '"', '`'] },
  },
}
