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
        command('Open…', 'file.open', 'CmdOrCtrl+O'),
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
      label: 'View',
      submenu: [
        command('Command Palette…', 'palette.commands', 'CmdOrCtrl+Shift+P'),
        { type: 'separator' },
        command('Split Right', 'view.splitRight'),
        command('Split Down', 'view.splitDown'),
        command('Close Pane', 'view.closePane'),
        command('Single Pane', 'view.singlePane'),
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
