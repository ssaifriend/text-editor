import { Show, createSignal } from 'solid-js'
import { type EncodingName, type Eol, encodingLabel, encodingNames, eolLabel, eolNames } from '@shared/encoding'
import type { Workspace } from '../../app/workspace'
import { languageById, languages } from '../../editor/lang'
import { Popup, type PopupItem } from './Popup'

type Menu = 'encoding' | 'eol' | 'language' | 'indent'

const tabWidths = [2, 4, 8]

export const StatusBar = (props: { ws: Workspace }) => {
  const [open, setOpen] = createSignal<Menu | null>(null)

  const activeMeta = () => {
    const leaf = props.ws.activeLeaf()
    const tab = leaf.active ? props.ws.state.tabs[leaf.active] : undefined
    return tab?.kind === 'buffer' ? props.ws.state.buffers[tab.bufferId] : undefined
  }

  const format = () => {
    const meta = activeMeta()
    return meta ? { encoding: meta.encoding, bom: meta.bom, eol: meta.eol } : null
  }

  const toggle = (menu: Menu) => () => setOpen(open() === menu ? null : menu)
  const close = () => setOpen(null)

  const encodingItems = (): PopupItem[] => {
    const current = format()
    const reinterpret = encodingNames.map((name): PopupItem => ({
      label: `Reinterpret as ${encodingLabel(name, false)}`,
      active: current?.encoding === name,
      onSelect: () => void props.ws.reinterpret(name),
    }))
    const saveWith = (name: EncodingName, bom: boolean): PopupItem => ({
      label: `Save with ${encodingLabel(name, bom)}`,
      active: current?.encoding === name && current.bom === bom,
      onSelect: () => props.ws.setEncoding(name, bom),
    })
    return [
      ...reinterpret,
      saveWith('utf8', false),
      saveWith('utf8', true),
      ...encodingNames.filter((n) => n !== 'utf8').map((n) => saveWith(n, false)),
    ]
  }

  const eolItems = (): PopupItem[] =>
    eolNames.map((eol: Eol) => ({ label: eolLabel(eol), active: format()?.eol === eol, onSelect: () => props.ws.setEol(eol) }))

  const languageItems = (): PopupItem[] =>
    languages.map((lang) => ({
      label: lang.name,
      active: activeMeta()?.languageId === lang.id,
      onSelect: () => props.ws.setLanguage(lang.id),
    }))

  const indentItems = (): PopupItem[] => {
    const meta = activeMeta()
    const tabSize = meta?.tabSize ?? 4
    const insertSpaces = meta?.insertSpaces ?? true
    return [
      { label: 'Indent Using Spaces', active: insertSpaces, onSelect: () => props.ws.setIndent(tabSize, true) },
      { label: 'Indent Using Tabs', active: !insertSpaces, onSelect: () => props.ws.setIndent(tabSize, false) },
      ...tabWidths.map((n) => ({
        label: `Tab Width: ${n}`,
        active: tabSize === n,
        onSelect: () => props.ws.setIndent(n, insertSpaces),
      })),
    ]
  }

  const indentLabel = (): string => {
    const meta = activeMeta()
    return meta ? `${meta.insertSpaces ? 'Spaces' : 'Tabs'}: ${meta.tabSize}` : ''
  }

  const items = (): PopupItem[] => {
    switch (open()) {
      case 'encoding':
        return encodingItems()
      case 'eol':
        return eolItems()
      case 'language':
        return languageItems()
      case 'indent':
        return indentItems()
      default:
        return []
    }
  }

  return (
    <div class="statusbar">
      <span data-testid="pos">
        Ln {props.ws.state.cursor.line}, Col {props.ws.state.cursor.col}
      </span>
      <button class="status-item" data-testid="encoding" onClick={toggle('encoding')}>
        {format() ? encodingLabel(format()!.encoding, format()!.bom) : ''}
      </button>
      <button class="status-item" data-testid="eol" onClick={toggle('eol')}>
        {format() ? eolLabel(format()!.eol) : ''}
      </button>
      <button class="status-item" data-testid="language" onClick={toggle('language')}>
        {activeMeta() ? languageById(activeMeta()!.languageId).name : ''}
      </button>
      <button class="status-item" data-testid="indent" onClick={toggle('indent')}>
        {indentLabel()}
      </button>
      <span class="grow" data-testid="path">
        {activeMeta()?.path ?? (activeMeta() ? 'untitled' : '')}
      </span>
      <span data-testid="status">{props.ws.state.status}</span>
      <Show when={open()}>
        <Popup items={items()} onClose={close} />
      </Show>
    </div>
  )
}
