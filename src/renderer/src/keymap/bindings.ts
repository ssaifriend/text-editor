import { A, pipe } from '@mobily/ts-belt'
import { type KeyStroke, type Platform, parseKeys, strokeEquals } from './keys'

export type Binding = {
  readonly keys: string
  readonly command: string
  readonly when?: string
  readonly args?: unknown
}

export type CompiledBinding = Binding & { readonly chord: readonly KeyStroke[] }

export type Resolution =
  | { readonly kind: 'run'; readonly binding: CompiledBinding }
  | { readonly kind: 'pending' }
  | { readonly kind: 'none' }

export type Conflict = { readonly keys: string; readonly when: string | undefined; readonly commands: readonly string[] }

export const compileBindings = (bindings: readonly Binding[], platform: Platform): readonly CompiledBinding[] =>
  bindings.map((b) => ({ ...b, chord: parseKeys(b.keys, platform) }))

const startsWith = (chord: readonly KeyStroke[], prefix: readonly KeyStroke[]): boolean =>
  prefix.length <= chord.length && prefix.every((s, i) => strokeEquals(s, chord[i] as KeyStroke))

export const resolveStroke = (
  bindings: readonly CompiledBinding[],
  pending: readonly KeyStroke[],
  stroke: KeyStroke,
  whenOk: (when?: string) => boolean,
): Resolution => {
  const sequence = [...pending, stroke]
  const candidates = pipe(
    bindings,
    A.filter((b) => startsWith(b.chord, sequence) && whenOk(b.when)),
  )

  const exact = pipe(
    candidates,
    A.filter((b) => b.chord.length === sequence.length),
    A.last,
  )
  if (exact) return { kind: 'run', binding: exact }

  return candidates.length > 0 ? { kind: 'pending' } : { kind: 'none' }
}

const strokeKey = (s: KeyStroke): string => `${s.ctrl ? 'c' : ''}${s.alt ? 'a' : ''}${s.shift ? 's' : ''}${s.meta ? 'm' : ''}:${s.key}`

const chordKey = (b: CompiledBinding): string => `${b.chord.map(strokeKey).join(' ')}|${b.when ?? ''}`

export const findConflicts = (bindings: readonly CompiledBinding[]): readonly Conflict[] => {
  const groups = bindings.reduce<Record<string, CompiledBinding[]>>((acc, b) => {
    const key = chordKey(b)
    return { ...acc, [key]: [...(acc[key] ?? []), b] }
  }, {})

  return pipe(
    Object.values(groups),
    A.map((group) => ({
      keys: group[0]?.keys ?? '',
      when: group[0]?.when,
      commands: A.uniq(group.map((b) => b.command)),
    })),
    A.filter((g) => g.commands.length > 1),
    (xs) => [...xs],
  )
}
