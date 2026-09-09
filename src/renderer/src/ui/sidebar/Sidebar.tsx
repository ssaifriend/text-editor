import { For, Show, createSignal } from 'solid-js'
import type { TreeEntry } from '@shared/ipc'
import type { Workspace } from '../../app/workspace'
import { basenameOf } from '../../editor/lang'
import { Popup, type PopupItem } from '../statusbar/Popup'

type Props = { readonly ws: Workspace }

type Menu = { readonly entry: TreeEntry; readonly x: number; readonly y: number }

const FolderIcon = (props: { open: boolean }) => (
  <svg class="tree-icon dir" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <Show
      when={props.open}
      fallback={<path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.2a1.5 1.5 0 0 1 1.06.44L8.3 3H13a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V3z" />}
    >
      <path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.2a1.5 1.5 0 0 1 1.06.44L8.3 3H13a1.5 1.5 0 0 1 1.5 1.5V6H3.6a1.5 1.5 0 0 0-1.43 1.04L1.5 9.2V3zm.3 10.3L3.3 7.7A.5.5 0 0 1 3.78 7.4H14.6a.5.5 0 0 1 .48.65l-1.6 5.4a.75.75 0 0 1-.72.55H2.5a.7.7 0 0 1-.7-.7z" />
    </Show>
  </svg>
)

const FileIcon = () => (
  <svg class="tree-icon file" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
    <path d="M4 1.5h5.5L13 5v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
    <path d="M9.5 1.5V5H13" />
    <path d="M5.5 8h5M5.5 10.5h5" stroke-linecap="round" />
  </svg>
)

const Rows = (props: { ws: Workspace; dir: string; depth: number; onMenu: (entry: TreeEntry, e: MouseEvent) => void }) => {
  const entries = () => props.ws.state.sidebar.entries[props.dir] ?? []
  const activePath = (): string | null => {
    const leaf = props.ws.activeLeaf()
    const tab = leaf.active ? props.ws.state.tabs[leaf.active] : undefined
    return tab?.kind === 'buffer' ? (props.ws.state.buffers[tab.bufferId]?.path ?? null) : null
  }

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
            classList={{
              dir: entry.kind === 'dir',
              expanded: props.ws.state.sidebar.expanded[entry.path] === true,
              active: entry.kind === 'file' && activePath() === entry.path,
            }}
            style={{ 'padding-left': `${8 + props.depth * 12}px` }}
            onClick={() => onClick(entry)}
            onContextMenu={(e) => {
              e.preventDefault()
              props.onMenu(entry, e)
            }}
          >
            <span class="tree-chevron">{entry.kind === 'dir' ? (props.ws.state.sidebar.expanded[entry.path] ? '▾' : '▸') : ''}</span>
            <Show when={entry.kind === 'dir'} fallback={<FileIcon />}>
              <FolderIcon open={props.ws.state.sidebar.expanded[entry.path] === true} />
            </Show>
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
