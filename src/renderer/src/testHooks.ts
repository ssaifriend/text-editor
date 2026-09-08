import type { Editor } from './editor/createEditor'
import type { FileMeta } from './App'

export type MoruTestHooks = {
  doc(): string
  selections(): { from: number; to: number }[]
  composing(): boolean
  focus(): void
  setCursor(pos: number): void
  setWhitespace(on: boolean): void
  path(): string | null
  meta(): FileMeta | null
  saveAs(mode: 'normal' | 'overwrite'): Promise<void>
}

declare global {
  interface Window {
    __moruTest?: MoruTestHooks
  }
}

type Bridges = {
  readonly path: () => string | null
  readonly meta: () => FileMeta | null
  readonly save: (mode: 'normal' | 'overwrite') => Promise<void>
}

export const installTestHooks = (editor: Editor, bridges: Bridges): void => {
  window.__moruTest = {
    doc: () => editor.view.state.doc.toString(),
    selections: () => editor.view.state.selection.ranges.map((r) => ({ from: r.from, to: r.to })),
    composing: () => editor.view.composing,
    focus: () => editor.view.focus(),
    setCursor: (pos) => editor.view.dispatch({ selection: { anchor: pos } }),
    setWhitespace: editor.setWhitespace,
    path: bridges.path,
    meta: bridges.meta,
    saveAs: bridges.save,
  }
}
