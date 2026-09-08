import type { Editor } from './editor/createEditor'

export type MoruTestHooks = {
  doc(): string
  selections(): { from: number; to: number }[]
  composing(): boolean
  focus(): void
  setCursor(pos: number): void
  setWhitespace(on: boolean): void
  path(): string | null
}

declare global {
  interface Window {
    __moruTest?: MoruTestHooks
  }
}

export const installTestHooks = (editor: Editor, currentPath: () => string | null): void => {
  window.__moruTest = {
    doc: () => editor.view.state.doc.toString(),
    selections: () => editor.view.state.selection.ranges.map((r) => ({ from: r.from, to: r.to })),
    composing: () => editor.view.composing,
    focus: () => editor.view.focus(),
    setCursor: (pos) => editor.view.dispatch({ selection: { anchor: pos } }),
    setWhitespace: editor.setWhitespace,
    path: currentPath,
  }
}
