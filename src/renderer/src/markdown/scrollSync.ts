import type { EditorView } from '@codemirror/view'

const lineElements = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-line]')).filter((el) => Number.isFinite(Number(el.dataset['line'])))

const lineOf = (el: HTMLElement): number => Number(el.dataset['line'])

export const elementForLine = (root: HTMLElement, line: number): HTMLElement | null => {
  let best: HTMLElement | null = null
  for (const el of lineElements(root)) {
    const n = lineOf(el)
    if (n <= line && (best === null || n > lineOf(best))) best = el
  }
  return best
}

export const lineForScrollTop = (root: HTMLElement, scrollTop: number): number | null => {
  const first = lineElements(root).find((el) => el.offsetTop >= scrollTop)
  return first ? lineOf(first) : null
}

export const topLineOf = (view: EditorView): number => {
  const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop)
  return view.state.doc.lineAt(Math.min(block.from, view.state.doc.length)).number
}
