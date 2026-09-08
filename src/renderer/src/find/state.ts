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

export { preserveCaseOf } from '@shared/replaceText'
