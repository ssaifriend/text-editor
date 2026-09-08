import { diff } from '@codemirror/merge'
import { Annotation, type ChangeSpec } from '@codemirror/state'

export const externalChangeAnnotation = Annotation.define<boolean>()

export const changeSetFromDiff = (oldText: string, newText: string): ChangeSpec[] =>
  diff(oldText, newText).map((change) => ({
    from: change.fromA,
    to: change.toA,
    insert: newText.slice(change.fromB, change.toB),
  }))
