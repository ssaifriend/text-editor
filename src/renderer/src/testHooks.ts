import type { Accessor } from 'solid-js'
import type { Workspace } from './app/workspace'
import type { CommandRegistry } from './commands/registry'
import type { WhenContext } from './commands/when'
import type { FileMeta } from './editor/buffers'
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
}

declare global {
  interface Window {
    __moruTest?: MoruTestHooks
  }
}

export const installTestHooks = (ws: Workspace, registry: CommandRegistry, paletteOpen: Accessor<boolean>): void => {
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
          const meta = tab ? ws.state.buffers[tab.bufferId] : undefined
          return {
            path: meta?.path ?? null,
            title: meta?.title ?? '',
            dirty: meta?.dirty ?? false,
            active: leaf.active === tabId,
          }
        }),
      })),
    runCommand: (id, args) => registry.run(id, args),
    openPath: (path) => ws.openFile(path),
    paletteOpen,
    context: () => whenContext(ws, { paletteOpen: paletteOpen() }),
  }
}
