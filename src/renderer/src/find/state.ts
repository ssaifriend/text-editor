import { EditorSelection, type SelectionRange, StateEffect, StateField } from '@codemirror/state'

export type FindSpec = {
  readonly search: string
  readonly replace: string
  readonly regexp: boolean
  readonly caseSensitive: boolean
  readonly wholeWord: boolean
  readonly inSelection: boolean
  readonly wrap: boolean
  readonly preserveCase: boolean
}

export const defaultFindSpec: FindSpec = {
  search: '',
  replace: '',
  regexp: false,
  caseSensitive: false,
  wholeWord: false,
  inSelection: false,
  wrap: true,
  preserveCase: false,
}

export const setInSelectionRanges = StateEffect.define<readonly { from: number; to: number }[] | null>()

export const inSelectionField = StateField.define<readonly SelectionRange[] | null>({
  create: () => null,
  update: (value, tr) => {
    const effect = tr.effects.find((e) => e.is(setInSelectionRanges))
    if (effect) return effect.value ? effect.value.map((r) => EditorSelection.range(r.from, r.to)) : null
    return value && tr.docChanged ? value.map((r) => r.map(tr.changes)) : value
  },
})

const isUpper = (s: string): boolean => s === s.toUpperCase() && s !== s.toLowerCase()
const isLower = (s: string): boolean => s === s.toLowerCase() && s !== s.toUpperCase()
const isCapitalized = (s: string): boolean =>
  s.length > 0 && isUpper(s.charAt(0)) && s.slice(1) === s.slice(1).toLowerCase() && s.length > 1

export const preserveCaseOf = (sample: string, replacement: string): string => {
  if (isUpper(sample)) return replacement.toUpperCase()
  if (isCapitalized(sample)) return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase()
  if (isLower(sample)) return replacement.toLowerCase()
  return replacement
}
