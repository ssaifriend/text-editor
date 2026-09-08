import type { Binding } from './bindings'
import type { Platform } from './keys'

const editor = (keys: string, command: string): Binding => ({ keys, command, when: 'editorFocus' })

const common: readonly Binding[] = [
  { keys: 'mod+n', command: 'file.new' },
  { keys: 'mod+shift+n', command: 'window.new' },
  { keys: 'mod+o', command: 'file.open' },
  { keys: 'mod+s', command: 'file.save' },
  { keys: 'mod+shift+s', command: 'file.saveAs' },
  { keys: 'mod+w', command: 'tab.close' },
  { keys: 'mod+shift+p', command: 'palette.commands' },
  { keys: 'mod+p', command: 'palette.goto' },
  { keys: 'mod+r', command: 'palette.gotoSymbol' },
  { keys: 'ctrl+g', command: 'palette.gotoLine' },
  { keys: 'mod+;', command: 'palette.gotoWord' },
  { keys: 'mod+f', command: 'find.open' },
  { keys: 'mod+alt+f', command: 'find.openReplace' },
  { keys: 'mod+alt+2', command: 'view.splitRight' },
  { keys: 'mod+alt+shift+2', command: 'view.splitDown' },
  { keys: 'mod+alt+1', command: 'view.singlePane' },
  { keys: 'ctrl+1', command: 'view.focusPane', args: 1 },
  { keys: 'ctrl+2', command: 'view.focusPane', args: 2 },
  { keys: 'ctrl+3', command: 'view.focusPane', args: 3 },
  { keys: 'ctrl+4', command: 'view.focusPane', args: 4 },
  { keys: 'ctrl+tab', command: 'tab.next' },
  { keys: 'ctrl+`', command: 'terminal.new' },
  { keys: 'mod+k mod+b', command: 'sidebar.toggle' },
  { keys: 'mod+alt+enter', command: 'terminal.sendSelection' },
  { keys: 'mod+alt+shift+enter', command: 'terminal.sendAtPath' },
  { keys: 'ctrl+shift+tab', command: 'tab.prev' },
  editor('mod+/', 'editor.toggleComment'),
  editor('mod+shift+d', 'editor.duplicateLine'),
  editor('ctrl+shift+k', 'editor.deleteLine'),
  editor('mod+l', 'editor.selectLine'),
  editor('mod+enter', 'editor.insertLineAfter'),
  editor('mod+shift+enter', 'editor.insertLineBefore'),
  editor('mod+]', 'editor.indentMore'),
  editor('mod+[', 'editor.indentLess'),
  editor('mod+d', 'editor.selectNextOccurrence'),
  editor('mod+shift+l', 'editor.splitSelectionIntoLines'),
  editor('mod+k mod+d', 'editor.skipOccurrence'),
  editor('mod+u', 'editor.undoSelection'),
  editor('mod+shift+u', 'editor.redoSelection'),
  editor('ctrl+m', 'editor.matchingBracket'),
  editor('mod+shift+space', 'editor.selectParent'),
  editor('mod+z', 'editor.undo'),
  editor('mod+shift+z', 'editor.redo'),
]

const tabSelect = (prefix: string): readonly Binding[] =>
  Array.from({ length: 9 }, (_, i) => ({ keys: `${prefix}+${i + 1}`, command: 'tab.select', args: i + 1 }))

const mac: readonly Binding[] = [
  ...tabSelect('mod'),
  editor('ctrl+mod+arrowup', 'editor.moveLineUp'),
  editor('ctrl+mod+arrowdown', 'editor.moveLineDown'),
  editor('ctrl+shift+arrowup', 'editor.addCursorAbove'),
  editor('ctrl+shift+arrowdown', 'editor.addCursorBelow'),
  editor('ctrl+mod+g', 'editor.selectAllOccurrences'),
  { keys: 'mod+g', command: 'find.next' },
  { keys: 'mod+shift+g', command: 'find.previous' },
]

const win: readonly Binding[] = [
  ...tabSelect('alt'),
  editor('ctrl+shift+arrowup', 'editor.moveLineUp'),
  editor('ctrl+shift+arrowdown', 'editor.moveLineDown'),
  editor('ctrl+alt+arrowup', 'editor.addCursorAbove'),
  editor('ctrl+alt+arrowdown', 'editor.addCursorBelow'),
  editor('alt+f3', 'editor.selectAllOccurrences'),
  editor('ctrl+y', 'editor.redo'),
  { keys: 'f3', command: 'find.next' },
  { keys: 'shift+f3', command: 'find.previous' },
]

export const defaultBindings = (platform: Platform): readonly Binding[] => [
  ...common,
  ...(platform === 'mac' ? mac : win),
]
