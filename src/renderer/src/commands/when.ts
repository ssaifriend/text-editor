export type WhenContext = Readonly<Record<string, boolean | string | undefined>>

type Token =
  | { kind: 'ident'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'op'; value: '&&' | '||' | '!' | '==' | '!=' | '(' | ')' }

const tokenize = (expr: string): Token[] | null => {
  const tokens: Token[] = []
  let i = 0

  while (i < expr.length) {
    const ch = expr[i] as string
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    const two = expr.slice(i, i + 2)
    if (two === '&&' || two === '||' || two === '==' || two === '!=') {
      tokens.push({ kind: 'op', value: two })
      i += 2
      continue
    }
    if (ch === '!' || ch === '(' || ch === ')') {
      tokens.push({ kind: 'op', value: ch })
      i += 1
      continue
    }
    if (ch === "'") {
      const end = expr.indexOf("'", i + 1)
      if (end < 0) return null
      tokens.push({ kind: 'string', value: expr.slice(i + 1, end) })
      i = end + 1
      continue
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(expr.slice(i))
    if (!ident) return null
    tokens.push({ kind: 'ident', value: ident[0] })
    i += ident[0].length
  }

  return tokens
}

type Parser = { readonly tokens: Token[]; pos: number }

const peek = (p: Parser): Token | undefined => p.tokens[p.pos]

const takeOp = (p: Parser, value: string): boolean => {
  const t = peek(p)
  if (t?.kind === 'op' && t.value === value) {
    p.pos += 1
    return true
  }
  return false
}

const truthy = (v: boolean | string | undefined): boolean => (typeof v === 'string' ? v.length > 0 : v === true)

const parsePrimary = (p: Parser, ctx: WhenContext): boolean | null => {
  if (takeOp(p, '(')) {
    const inner = parseOr(p, ctx)
    return inner !== null && takeOp(p, ')') ? inner : null
  }

  const t = peek(p)
  if (t?.kind !== 'ident') return null
  p.pos += 1

  const next = peek(p)
  if (next?.kind === 'op' && (next.value === '==' || next.value === '!=')) {
    p.pos += 1
    const rhs = peek(p)
    if (!rhs || rhs.kind === 'op') return null
    p.pos += 1
    const left = ctx[t.value]
    const right = rhs.kind === 'string' ? rhs.value : ctx[rhs.value]
    const equal = String(left ?? '') === String(right ?? '')
    return next.value === '==' ? equal : !equal
  }

  return truthy(ctx[t.value])
}

const parseUnary = (p: Parser, ctx: WhenContext): boolean | null => {
  if (takeOp(p, '!')) {
    const v = parseUnary(p, ctx)
    return v === null ? null : !v
  }
  return parsePrimary(p, ctx)
}

const parseAnd = (p: Parser, ctx: WhenContext): boolean | null => {
  let left = parseUnary(p, ctx)
  while (left !== null && takeOp(p, '&&')) {
    const right = parseUnary(p, ctx)
    left = right === null ? null : left && right
  }
  return left
}

const parseOr = (p: Parser, ctx: WhenContext): boolean | null => {
  let left = parseAnd(p, ctx)
  while (left !== null && takeOp(p, '||')) {
    const right = parseAnd(p, ctx)
    left = right === null ? null : left || right
  }
  return left
}

export const evaluateWhen = (expr: string | undefined, ctx: WhenContext): boolean => {
  if (!expr || expr.trim() === '') return true

  const tokens = tokenize(expr)
  if (!tokens) return false

  const parser: Parser = { tokens, pos: 0 }
  const result = parseOr(parser, ctx)
  return result !== null && parser.pos === tokens.length ? result : false
}
