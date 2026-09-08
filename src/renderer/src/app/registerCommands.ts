import { R } from '@mobily/ts-belt'
import type { CommandRegistry } from '../commands/registry'
import { editorCommands } from '../editor/commands'
import { invoke } from '../ipc'
import type { Workspace } from './workspace'

type Ui = { readonly openPalette: () => void }

const asIndex = (args: unknown): number => (typeof args === 'number' ? args : Number(args) || 1)

export const registerAppCommands = (registry: CommandRegistry, ws: Workspace, ui: Ui): void => {
  registry.registerAll([
    { id: 'file.new', title: 'File: New File', run: () => ws.newUntitled() },
    {
      id: 'file.open',
      title: 'File: Open…',
      run: async () => {
        const picked = await invoke('dialog.openFile', undefined)
        const path = R.match(
          picked,
          (d) => d.path,
          () => null,
        )
        if (path) await ws.openFile(path)
      },
    },
    { id: 'file.save', title: 'File: Save', run: () => ws.save() },
    { id: 'file.saveAs', title: 'File: Save As…', run: () => ws.saveAs() },
    { id: 'tab.close', title: 'Tab: Close', run: () => ws.closeTab() },
    { id: 'tab.next', title: 'Tab: Next', run: () => ws.cycleTab(1) },
    { id: 'tab.prev', title: 'Tab: Previous', run: () => ws.cycleTab(-1) },
    { id: 'tab.select', title: 'Tab: Select by Index', run: (args) => ws.selectTabIndex(asIndex(args)) },
    { id: 'view.splitRight', title: 'View: Split Right', run: () => ws.splitActive('row') },
    { id: 'view.splitDown', title: 'View: Split Down', run: () => ws.splitActive('col') },
    { id: 'view.closePane', title: 'View: Close Pane', run: () => ws.closeActivePane() },
    { id: 'view.singlePane', title: 'View: Single Pane', run: () => ws.singlePane() },
    { id: 'view.focusPane', title: 'View: Focus Pane by Index', run: (args) => ws.focusPaneIndex(asIndex(args)) },
    { id: 'palette.commands', title: 'Command Palette', run: () => ui.openPalette() },
    ...editorCommands.map((spec) => ({
      id: spec.id,
      title: `Edit: ${spec.title}`,
      when: 'editorFocus',
      run: () => {
        const view = ws.activeView()
        if (view) spec.run(view)
      },
    })),
  ])
}
