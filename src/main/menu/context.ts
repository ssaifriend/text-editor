import type { MenuItemConstructorOptions } from 'electron'
import type { ContextMenuRequest } from '@shared/ipc'

type Run = (commandId: string) => void

const item = (label: string, id: string, run: Run, enabled = true): MenuItemConstructorOptions => ({ label, enabled, click: () => run(id) })
const separator: MenuItemConstructorOptions = { type: 'separator' }

export const editorContextMenu = (req: ContextMenuRequest, run: Run): MenuItemConstructorOptions[] => [
  { role: 'cut', enabled: req.hasSelection },
  { role: 'copy', enabled: req.hasSelection },
  { role: 'paste' },
  item('Select All', 'editor.selectAll', run),
  separator,
  item('Find…', 'find.open', run),
  item('Replace…', 'find.openReplace', run),
  item('Find in Files…', 'search.project', run),
  separator,
  item('Toggle Comment', 'editor.toggleComment', run),
  item('Goto Symbol…', 'palette.gotoSymbol', run),
  ...(req.languageId === 'markdown' ? [item('Toggle Markdown Preview', 'markdown.togglePreview', run)] : []),
  ...(req.hasTerminal ? [separator, item('Send Selection to Terminal', 'terminal.sendSelection', run, req.hasSelection), item('Send Path to Terminal', 'terminal.sendPath', run, req.path !== null)] : []),
  ...(req.path !== null ? [separator, item('Copy File Path', 'file.copyPath', run), item('Reveal in Sidebar', 'sidebar.reveal', run)] : []),
]
