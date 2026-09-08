import { R } from '@mobily/ts-belt'
import { z } from 'zod'
import { EncodingName, Eol } from '@shared/ipc'
import type { CommandRegistry } from '../commands/registry'
import { type CompiledBinding, findConflicts } from '../keymap/bindings'
import { editorCommands } from '../editor/commands'
import { invoke } from '../ipc'
import type { Workspace } from './workspace'

type Ui = {
  readonly openPalette: (mode: 'commands' | 'goto', text?: string) => void
  readonly userBindings: () => readonly CompiledBinding[]
}

const asIndex = (args: unknown): number => (typeof args === 'number' ? args : Number(args) || 1)

const shellQuote = (text: string): string => `'${text.replace(/'/g, "'\\''")}'`

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
    { id: 'palette.commands', title: 'Command Palette', run: () => ui.openPalette('commands') },
    { id: 'palette.goto', title: 'Goto Anything…', run: () => ui.openPalette('goto') },
    { id: 'palette.gotoSymbol', title: 'Goto Symbol…', when: 'hasBuffer', run: () => ui.openPalette('goto', '@') },
    { id: 'palette.gotoLine', title: 'Goto Line…', when: 'hasBuffer', run: () => ui.openPalette('goto', ':') },
    { id: 'palette.gotoWord', title: 'Goto Word…', when: 'hasBuffer', run: () => ui.openPalette('goto', '#') },
    { id: 'find.open', title: 'Find', when: 'hasBuffer', run: () => ws.openFind(false) },
    { id: 'find.openReplace', title: 'Replace', when: 'hasBuffer', run: () => ws.openFind(true) },
    { id: 'find.next', title: 'Find Next', when: 'hasBuffer', run: () => ws.findNext() },
    { id: 'find.previous', title: 'Find Previous', when: 'hasBuffer', run: () => ws.findPrevious() },
    { id: 'find.selectAll', title: 'Find All', when: 'hasBuffer', run: () => ws.findSelectAll() },
    { id: 'find.replaceNext', title: 'Replace Next', when: 'hasBuffer', run: () => ws.replaceNext() },
    { id: 'find.replaceAll', title: 'Replace All', when: 'hasBuffer', run: () => ws.replaceAll() },
    { id: 'find.close', title: 'Close Find Panel', when: 'hasBuffer', run: () => ws.closeFind() },
    { id: 'sidebar.toggle', title: 'View: Toggle Sidebar', run: () => ws.toggleSidebar() },
    { id: 'window.new', title: 'Window: New Window', run: async () => void (await invoke('window.new', undefined)) },
    {
      id: 'project.openFolder',
      title: 'File: Open Folder…',
      run: async () => {
        const picked = await invoke('dialog.openFolder', undefined)
        const path = R.match(
          picked,
          (d) => d.path,
          () => null,
        )
        if (path) await ws.setProjectRoot(path)
      },
    },
    {
      id: 'sidebar.newFile',
      title: 'Sidebar: New File',
      run: (args) => {
        const a = z.object({ dir: z.string(), name: z.string().min(1) }).parse(args)
        return ws.createFileIn(a.dir, a.name)
      },
    },
    {
      id: 'sidebar.rename',
      title: 'Sidebar: Rename',
      run: (args) => {
        const a = z.object({ path: z.string(), name: z.string().min(1) }).parse(args)
        return ws.renameEntry(a.path, a.name)
      },
    },
    {
      id: 'sidebar.delete',
      title: 'Sidebar: Delete',
      run: (args) => ws.deleteEntry(z.object({ path: z.string() }).parse(args).path),
    },
    {
      id: 'sidebar.refresh',
      title: 'Sidebar: Refresh',
      run: () => {
        const root = ws.state.projectRoot
        if (root) void ws.refreshDir(root)
      },
    },
    { id: 'terminal.new', title: 'Terminal: New Terminal', run: () => ws.newTerminal() },
    { id: 'terminal.restart', title: 'Terminal: Restart', when: 'terminalFocus', run: () => ws.restartActiveTerminal() },
    {
      id: 'terminal.sendSelection',
      title: 'Terminal: Send Selection',
      when: 'editorFocus && hasSelection',
      run: () => {
        const view = ws.activeView()
        if (view) void ws.sendToTerminal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to))
      },
    },
    {
      id: 'terminal.sendPath',
      title: 'Terminal: Send File Path',
      when: 'hasBuffer',
      run: () => {
        const path = ws.activeBuffer()?.meta?.path
        if (path) void ws.sendToTerminal(shellQuote(path))
      },
    },
    {
      id: 'terminal.sendAtPath',
      title: 'Terminal: Send @path',
      when: 'hasBuffer',
      run: () => {
        const path = ws.activeBuffer()?.meta?.path
        if (path) void ws.sendToTerminal(`@${ws.relativePath(path)} `)
      },
    },
    {
      id: 'keymap.showConflicts',
      title: 'Keymap: Show Conflicts',
      run: () => {
        const conflicts = findConflicts(ui.userBindings())
        ws.setStatus(
          conflicts.length === 0
            ? 'no keymap conflicts'
            : `${conflicts.length} keymap conflict(s): ${conflicts.map((c) => c.keys).join(', ')}`,
        )
        window.moru.send('log.write', { level: 'warn', message: 'keymap conflicts', meta: conflicts })
      },
    },
    { id: 'buffer.setEol', title: 'Buffer: Set Line Endings', when: 'hasBuffer', run: (args) => ws.setEol(Eol.parse(args)) },
    {
      id: 'buffer.setEncoding',
      title: 'Buffer: Save with Encoding',
      when: 'hasBuffer',
      run: (args) => {
        const a = z.object({ encoding: EncodingName, bom: z.boolean() }).parse(args)
        ws.setEncoding(a.encoding, a.bom)
      },
    },
    {
      id: 'buffer.reinterpret',
      title: 'Buffer: Reinterpret as Encoding',
      when: 'hasBuffer',
      run: (args) => ws.reinterpret(EncodingName.parse(args)),
    },
    { id: 'buffer.setLanguage', title: 'Buffer: Set Syntax', when: 'hasBuffer', run: (args) => ws.setLanguage(z.string().parse(args)) },
    {
      id: 'buffer.setIndent',
      title: 'Buffer: Set Indentation',
      when: 'hasBuffer',
      run: (args) => {
        const a = z.object({ tabSize: z.number().int().min(1).max(16), insertSpaces: z.boolean() }).parse(args)
        ws.setIndent(a.tabSize, a.insertSpaces)
      },
    },
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
