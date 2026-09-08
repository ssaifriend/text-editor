import { encodingLabel, eolLabel } from '@shared/encoding'
import type { Workspace } from '../../app/workspace'
import { languageById } from '../../editor/lang'

export const StatusBar = (props: { ws: Workspace }) => {
  const activeMeta = () => {
    const leaf = props.ws.activeLeaf()
    const tab = leaf.active ? props.ws.state.tabs[leaf.active] : undefined
    return tab ? props.ws.state.buffers[tab.bufferId] : undefined
  }

  const fileMeta = () => (activeMeta() ? props.ws.activeBuffer()?.meta ?? null : null)

  return (
    <div class="statusbar">
      <span data-testid="pos">
        Ln {props.ws.state.cursor.line}, Col {props.ws.state.cursor.col}
      </span>
      <span data-testid="encoding">{fileMeta() ? encodingLabel(fileMeta()!.encoding, fileMeta()!.bom) : ''}</span>
      <span data-testid="eol">{fileMeta() ? eolLabel(fileMeta()!.eol) : ''}</span>
      <span data-testid="language">{activeMeta() ? languageById(activeMeta()!.languageId).name : ''}</span>
      <span class="grow" data-testid="path">
        {activeMeta()?.path ?? (activeMeta() ? 'untitled' : '')}
      </span>
      <span data-testid="status">{props.ws.state.status}</span>
    </div>
  )
}
