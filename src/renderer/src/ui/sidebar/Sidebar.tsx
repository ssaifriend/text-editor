import { For, Show, createSignal } from 'solid-js'
import type { TreeEntry } from '@shared/ipc'
import type { Workspace } from '../../app/workspace'
import { basenameOf } from '../../editor/lang'
import { Popup, type PopupItem } from '../statusbar/Popup'

type Props = { readonly ws: Workspace }

type Menu = { readonly entry: TreeEntry; readonly x: number; readonly y: number }

const Rows = (props: { ws: Workspace; dir: string; depth: number; onMenu: (entry: TreeEntry, e: MouseEvent) => void }) => {
  const entries = () => props.ws.state.sidebar.entries[props.dir] ?? []

  const onClick = (entry: TreeEntry): void => {
    if (entry.kind === 'dir') {
      if (props.ws.state.sidebar.expanded[entry.path]) props.ws.collapseDir(entry.path)
      else void props.ws.expandDir(entry.path)
    } else {
      void props.ws.openFile(entry.path)
    }
  }

  return (
    <For each={entries()}>
      {(entry) => (
        <>
          <div
            class="tree-row"
            data-testid="tree-row"
            data-path={entry.path}
            classList={{ dir: entry.kind === 'dir', expanded: props.ws.state.sidebar.expanded[entry.path] === true }}
            style={{ 'padding-left': `${8 + props.depth * 12}px` }}
            onClick={() => onClick(entry)}
            onContextMenu={(e) => {
              e.preventDefault()
              props.onMenu(entry, e)
            }}
          >
            <span class="tree-chevron">{entry.kind === 'dir' ? (props.ws.state.sidebar.expanded[entry.path] ? '▾' : '▸') : ''}</span>
            <span class="tree-name">{entry.name}</span>
          </div>
          <Show when={entry.kind === 'dir' && props.ws.state.sidebar.expanded[entry.path]}>
            <Rows ws={props.ws} dir={entry.path} depth={props.depth + 1} onMenu={props.onMenu} />
          </Show>
        </>
      )}
    </For>
  )
}

export const Sidebar = (props: Props) => {
  const [menu, setMenu] = createSignal<Menu | null>(null)

  const parentOf = (entry: TreeEntry): string => entry.path.slice(0, entry.path.length - entry.name.length - 1)

  const items = (entry: TreeEntry): PopupItem[] => [
    {
      label: 'New File…',
      onSelect: () => {
        const name = window.prompt('File name')
        if (name) void props.ws.createFileIn(entry.kind === 'dir' ? entry.path : parentOf(entry), name)
      },
    },
    {
      label: 'Rename…',
      onSelect: () => {
        const name = window.prompt('New name', entry.name)
        if (name && name !== entry.name) void props.ws.renameEntry(entry.path, name)
      },
    },
    {
      label: 'Delete',
      onSelect: () => {
        if (window.confirm(`Move ${entry.name} to the trash?`)) void props.ws.deleteEntry(entry.path)
      },
    },
  ]

  return (
    <Show when={props.ws.state.sidebar.open}>
      <aside class="sidebar" data-testid="sidebar">
        <div class="sidebar-header" title={props.ws.state.projectRoot ?? ''}>
          {props.ws.state.projectRoot ? basenameOf(props.ws.state.projectRoot).toUpperCase() : 'NO FOLDER'}
        </div>
        <div class="sidebar-tree">
          <Show when={props.ws.state.projectRoot}>
            {(root) => <Rows ws={props.ws} dir={root()} depth={0} onMenu={(entry, e) => setMenu({ entry, x: e.clientX, y: e.clientY })} />}
          </Show>
        </div>
        <Show when={menu()}>
          {(m) => (
            <div class="sidebar-menu" style={{ left: `${m().x}px`, top: `${m().y}px` }}>
              <Popup items={items(m().entry)} onClose={() => setMenu(null)} />
            </div>
          )}
        </Show>
      </aside>
    </Show>
  )
}
