import { search } from '@codemirror/search'
import type { Extension } from '@codemirror/state'
import { inSelectionField } from './state'

const hiddenPanel = (): { dom: HTMLElement; top: boolean } => {
  const dom = document.createElement('div')
  dom.className = 'moru-hidden-search-panel'
  return { dom, top: false }
}

export const findExtensions: Extension = [search({ createPanel: hiddenPanel, top: false }), inSelectionField]
