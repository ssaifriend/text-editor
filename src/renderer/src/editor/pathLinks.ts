import { type Extension, RangeSetBuilder } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { type PathRef, parsePathRefs } from '../terminal/links'

export type PathLinkHooks = { readonly openPathRef: (ref: PathRef) => void }

const decorate = (view: EditorView): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos)
      for (const ref of parsePathRefs(line.text)) {
        builder.add(
          line.from + ref.start,
          line.from + ref.end,
          Decoration.mark({
            class: 'cm-path-link',
            attributes: { 'data-path': ref.path, 'data-line': String(ref.line ?? ''), 'data-col': String(ref.col ?? '') },
          }),
        )
      }
      pos = line.to + 1
    }
  }
  return builder.finish()
}

const refFromElement = (target: EventTarget | null): PathRef | null => {
  const el = target instanceof Element ? target.closest<HTMLElement>('.cm-path-link') : null
  if (!el) return null
  const path = el.dataset['path'] ?? ''
  if (path === '') return null
  const line = Number(el.dataset['line'])
  const col = Number(el.dataset['col'])
  return { text: el.textContent ?? path, start: 0, end: 0, path, line: line > 0 ? line : undefined, col: col > 0 ? col : undefined }
}

export const pathLinks = (hooks: PathLinkHooks): Extension => [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = decorate(view)
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) this.decorations = decorate(update.view)
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
  EditorView.domEventHandlers({
    mousedown: (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false
      const ref = refFromElement(event.target)
      if (!ref) return false
      event.preventDefault()
      hooks.openPathRef(ref)
      return true
    },
  }),
]

export const installModifierTracking = (target: Window = window): (() => void) => {
  const update = (e: KeyboardEvent): void => {
    document.body.classList.toggle('mod-held', e.metaKey || e.ctrlKey)
  }
  const clear = (): void => document.body.classList.remove('mod-held')
  target.addEventListener('keydown', update, true)
  target.addEventListener('keyup', update, true)
  target.addEventListener('blur', clear)
  return () => {
    target.removeEventListener('keydown', update, true)
    target.removeEventListener('keyup', update, true)
    target.removeEventListener('blur', clear)
  }
}
