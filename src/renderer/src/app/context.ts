import type { WhenContext } from '../commands/when'
import type { Workspace } from './workspace'

export const whenContext = (ws: Workspace, extra: Record<string, boolean | string> = {}): WhenContext => {
  const selection = ws.activeView()?.state.selection
  return {
    editorFocus: ws.state.editorFocused,
    terminalFocus: ws.state.terminalFocused,
    findFocus: ws.state.findFocused,
    searchFocus: ws.state.searchFocused,
    hasBuffer: ws.activeBuffer() !== null,
    hasTerminal: Object.values(ws.state.terminals).some((t) => t.alive),
    hasSelection: selection ? selection.ranges.some((r) => !r.empty) : false,
    hasMultipleSelections: selection ? selection.ranges.length > 1 : false,
    languageId: ws.activeBuffer()?.languageId ?? '',
    ...extra,
  }
}
