import { EditorView, ViewPlugin } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

const mirrorComposing = ViewPlugin.fromClass(
  class {
    constructor(private readonly view: EditorView) {
      this.sync()
    }

    update(): void {
      this.sync()
    }

    private sync(): void {
      this.view.dom.dataset['composing'] = String(this.view.composing)
    }
  },
)

const mirrorCompositionStarted = EditorView.domEventHandlers({
  compositionstart: (_event, view) => {
    view.dom.dataset['compositionStarted'] = 'true'
    return false
  },
  compositionend: (_event, view) => {
    view.dom.dataset['compositionStarted'] = 'false'
    return false
  },
})

export const compositionObserver: Extension = [mirrorComposing, mirrorCompositionStarted]
