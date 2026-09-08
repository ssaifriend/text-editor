import { indentUnit } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { Accessor } from 'solid-js'
import type { Workspace } from './app/workspace'
import type { CommandRegistry } from './commands/registry'
import type { WhenContext } from './commands/when'
import type { CompiledBinding } from './keymap/bindings'
import { type FileMeta, type Format, isDirty } from './editor/buffers'
import { whenContext } from './app/context'
import { leaves } from './ui/layout/paneTree'

export type TabInfo = { path: string | null; title: string; dirty: boolean; active: boolean }
export type PaneInfo = { paneId: string; active: boolean; tabs: TabInfo[] }

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
  tabs(): PaneInfo[]
  runCommand(id: string, args?: unknown): Promise<boolean>
  openPath(path: string): Promise<boolean>
  paletteOpen(): boolean
  context(): WhenContext
  editorSettings(): { tabSize: number; indentUnit: string; lineNumbers: boolean; wordWrap: boolean }
  ready(): boolean
  format(): Format | null
  dirty(): boolean
  bindingFor(commandId: string): string | null
  terminals(): { id: string; title: string; alive: boolean; exitCode: number | null }[]
  terminalText(): string
  terminalFocus(): void
  setSelection(from: number, to: number): void
  projectRoot(): string | null
  bannerKind(): string | null
  windowId(): string
}

declare global {
  interface Window {
    __moruTest?: MoruTestHooks
  }
}

export const installTestHooks = (
  ws: Workspace,
  registry: CommandRegistry,
  paletteOpen: Accessor<boolean>,
  ready: Accessor<boolean>,
  bindings: Accessor<readonly CompiledBinding[]>,
): void => {
  const view = () => {
    const v = ws.activeView()
    if (!v) throw new Error('no active editor view')
    return v
  }

  window.__moruTest = {
    doc: () => view().state.doc.toString(),
    selections: () => view().state.selection.ranges.map((r) => ({ from: r.from, to: r.to })),
    composing: () => view().composing,
    focus: () => view().focus(),
    setCursor: (pos) => view().dispatch({ selection: { anchor: pos } }),
    setWhitespace: () => undefined,
    path: () => ws.activeBuffer()?.meta?.path ?? null,
    meta: () => ws.activeBuffer()?.meta ?? null,
    saveAs: (mode) => ws.save(mode),
    tabs: () =>
      leaves(ws.tree()).map((leaf) => ({
        paneId: leaf.id,
        active: leaf.id === ws.state.activePane,
        tabs: leaf.tabs.map((tabId) => {
          const tab = ws.state.tabs[tabId]
          const meta = tab?.kind === 'buffer' ? ws.state.buffers[tab.bufferId] : undefined
          const title =
            tab?.kind === 'terminal'
              ? (ws.state.terminals[tab.ptyId]?.title ?? 'Terminal')
              : tab?.kind === 'diff'
                ? tab.title
                : (meta?.title ?? '')
          return {
            path: meta?.path ?? null,
            title,
            dirty: meta?.dirty ?? false,
            active: leaf.active === tabId,
          }
        }),
      })),
    runCommand: (id, args) => registry.run(id, args),
    openPath: (path) => ws.openFile(path),
    paletteOpen,
    context: () => whenContext(ws, { paletteOpen: paletteOpen() }),
    editorSettings: () => {
      const v = view()
      return {
        tabSize: v.state.facet(EditorState.tabSize),
        indentUnit: v.state.facet(indentUnit),
        lineNumbers: v.dom.querySelector('.cm-gutters') !== null,
        wordWrap: v.contentDOM.classList.contains('cm-lineWrapping'),
      }
    },
    ready,
    format: () => ws.activeBuffer()?.format ?? null,
    dirty: () => {
      const b = ws.activeBuffer()
      return b ? isDirty(b) : false
    },
    bindingFor: (commandId) => [...bindings()].reverse().find((b) => b.command === commandId)?.keys ?? null,
    terminals: () => Object.values(ws.state.terminals).map((t) => ({ id: t.id, title: t.title, alive: t.alive, exitCode: t.exitCode })),
    terminalText: () => {
      const id = ws.activeTerminalId() ?? Object.keys(ws.state.terminals).at(-1)
      const entry = id ? ws.terminalRegistry.get(id) : null
      if (!entry) return ''
      const buffer = entry.term.buffer.active
      const lines = Array.from({ length: buffer.length }, (_, y) => buffer.getLine(y)?.translateToString(true) ?? '')
      return lines.join('\n').replace(/\s+$/, '')
    },
    terminalFocus: () => {
      const id = ws.activeTerminalId() ?? Object.keys(ws.state.terminals).at(-1)
      const entry = id ? ws.terminalRegistry.get(id) : null
      entry?.term.focus()
    },
    setSelection: (from, to) => view().dispatch({ selection: { anchor: from, head: to } }),
    projectRoot: () => ws.state.projectRoot,
    windowId: () => ws.state.windowId,
    bannerKind: () => {
      const b = ws.activeBuffer()
      return b ? (ws.state.banners[b.id]?.kind ?? null) : null
    },
  }
}
