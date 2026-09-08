import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { pushToAll } from './ipc/push'

const command = (label: string, id: string, accelerator?: string): MenuItemConstructorOptions => ({
  id,
  label,
  accelerator,
  registerAccelerator: false,
  click: () => pushToAll('command.run', { id }),
})

export const installMenu = (): void => {
  const isMac = process.platform === 'darwin'

  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }]
    : []

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: 'File',
      submenu: [
        command('New File', 'file.new', 'CmdOrCtrl+N'),
        command('New Window', 'window.new', 'CmdOrCtrl+Shift+N'),
        command('Open…', 'file.open', 'CmdOrCtrl+O'),
        command('Open Folder…', 'project.openFolder'),
        { type: 'separator' },
        command('Save', 'file.save', 'CmdOrCtrl+S'),
        command('Save As…', 'file.saveAs', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        command('Close Tab', 'tab.close', 'CmdOrCtrl+W'),
        ...(isMac ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, { role: 'quit' } as MenuItemConstructorOptions]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Find',
      submenu: [
        command('Find…', 'find.open', 'CmdOrCtrl+F'),
        command('Replace…', 'find.openReplace', 'CmdOrCtrl+Alt+F'),
        { type: 'separator' },
        command('Find in Files…', 'search.project', 'CmdOrCtrl+Shift+F'),
        command('Undo Replace in Files', 'search.undoReplace'),
      ],
    },
    {
      label: 'View',
      submenu: [
        command('Command Palette…', 'palette.commands', 'CmdOrCtrl+Shift+P'),
        command('Toggle Sidebar', 'sidebar.toggle'),
        { type: 'separator' },
        command('Split Right', 'view.splitRight'),
        command('Split Down', 'view.splitDown'),
        command('Close Pane', 'view.closePane'),
        command('Single Pane', 'view.singlePane'),
        { type: 'separator' },
        command('New Terminal', 'terminal.new'),
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Markdown',
      submenu: [
        command('Toggle Preview', 'markdown.togglePreview', 'CmdOrCtrl+Shift+V'),
        { type: 'separator' },
        command('Export HTML…', 'markdown.exportHtml'),
        command('Export PDF…', 'markdown.exportPdf'),
        command('Copy HTML', 'markdown.copyHtml'),
      ],
    },
    {
      label: 'Goto',
      submenu: [
        command('Goto Anything…', 'palette.goto', 'CmdOrCtrl+P'),
        command('Goto Symbol…', 'palette.gotoSymbol', 'CmdOrCtrl+R'),
        command('Goto Line…', 'palette.gotoLine', 'Ctrl+G'),
      ],
    },
    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
