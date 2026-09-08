import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { A, D, R, pipe } from '@mobily/ts-belt'
import { createSignal } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import type { OpenedFile, SaveError } from '@shared/ipc'
import { type Buffer, type BufferId, type FileMeta, createBuffer, isDirty, markSaved, titleOf } from '../editor/buffers'
import { baseExtensions, makeState } from '../editor/createEditor'
import { cursorPosition, type CursorPosition } from '../editor/cursor'
import { languageById } from '../editor/lang'
import { invoke } from '../ipc'
import {
  addTab,
  closeLeaf,
  createLeaf,
  findLeaf,
  leafOfTab,
  leaves,
  moveTab,
  type PaneId,
  type PaneLeaf,
  type PaneNode,
  removeTab,
  resizeSplit as resizeSplitTree,
  setActiveTab,
  siblingLeaf,
  splitLeaf,
  type TabId,
} from '../ui/layout/paneTree'

export type Tab = { readonly id: TabId; readonly kind: 'buffer'; readonly bufferId: BufferId }
export type BufferMeta = {
  readonly id: BufferId
  readonly path: string | null
  readonly title: string
  readonly dirty: boolean
  readonly languageId: string
}
export type CloseChoice = 'save' | 'dontSave' | 'cancel'
export type SaveMode = 'normal' | 'overwrite'

export type WorkspaceState = {
  tabs: Record<TabId, Tab>
  buffers: Record<BufferId, BufferMeta>
  activePane: PaneId
  editorFocused: boolean
  cursor: CursorPosition
  status: string
}

export type Workspace = {
  readonly state: WorkspaceState
  readonly tree: () => PaneNode
  readonly setEditorFocus: (paneId: PaneId, focused: boolean) => void
  readonly getBuffer: (id: BufferId) => Buffer | null
  readonly activeLeaf: () => PaneLeaf
  readonly activeBuffer: () => Buffer | null
  readonly activeView: () => EditorView | null
  readonly registerView: (paneId: PaneId, view: EditorView) => void
  readonly unregisterView: (paneId: PaneId) => void
  readonly openFile: (path: string) => Promise<boolean>
  readonly newUntitled: () => void
  readonly closeTab: (tabId?: TabId) => Promise<void>
  readonly activateTab: (paneId: PaneId, tabId: TabId) => void
  readonly selectTabIndex: (n: number) => void
  readonly cycleTab: (delta: 1 | -1) => void
  readonly splitActive: (direction: 'row' | 'col') => void
  readonly closeActivePane: () => void
  readonly singlePane: () => void
  readonly focusPaneIndex: (n: number) => void
  readonly focusPane: (paneId: PaneId) => void
  readonly resizeSplit: (splitId: PaneId, sizes: readonly number[]) => void
  readonly save: (mode?: SaveMode) => Promise<void>
  readonly saveAs: () => Promise<void>
  readonly setStatus: (text: string) => void
}

type Deps = { readonly confirmClose: (title: string) => Promise<CloseChoice> }

const describeSaveError = (error: SaveError): string => {
  switch (error.kind) {
    case 'conflict':
      return 'conflict: file changed on disk (use overwrite to replace it)'
    case 'encodingLossy':
      return `encoding cannot represent ${error.positions.length} character(s); save as UTF-8?`
    case 'readonly':
      return `read-only: ${error.message}`
    default:
      return `save failed: ${error.message}`
  }
}

const metaOf = (buffer: Buffer): BufferMeta => ({
  id: buffer.id,
  path: buffer.meta?.path ?? null,
  title: titleOf(buffer),
  dirty: isDirty(buffer),
  languageId: buffer.languageId,
})

const sameMeta = (a: BufferMeta | undefined, b: BufferMeta): boolean =>
  a !== undefined && a.dirty === b.dirty && a.title === b.title && a.path === b.path && a.languageId === b.languageId

const counter = (prefix: string) => {
  let n = 0
  return (): string => `${prefix}${(n += 1)}`
}

const appendAll = (tree: PaneNode, tabIds: readonly TabId[], toPaneId: PaneId): PaneNode =>
  tabIds.reduce((t, tabId) => moveTab(t, tabId, toPaneId, findLeaf(t, toPaneId)?.tabs.length ?? 0), tree)

export const createWorkspace = ({ confirmClose }: Deps): Workspace => {
  const nextBufferId = counter('b')
  const nextTabId = counter('t')
  const nextPaneId = counter('p')

  const firstPane = nextPaneId()
  const [state, setState] = createStore<WorkspaceState>({
    tabs: {},
    buffers: {},
    activePane: firstPane,
    editorFocused: false,
    cursor: { line: 1, col: 1 },
    status: '',
  })

  let buffers: Record<BufferId, Buffer> = {}
  let views: Record<PaneId, EditorView> = {}

  let currentTree: PaneNode = createLeaf(firstPane)
  const [treeVersion, setTreeVersion] = createSignal(0)

  const tree = (): PaneNode => {
    treeVersion()
    return currentTree
  }

  const setTree = (next: PaneNode): void => {
    if (next === currentTree) return
    currentTree = next
    setTreeVersion((v) => v + 1)
  }

  const paneOfView = (view: EditorView): PaneId | null =>
    pipe(
      D.toPairs(views),
      A.find(([, v]) => v === view),
      (found) => (found ? found[0] : null),
    )

  const bufferInPane = (paneId: PaneId): Buffer | null => {
    const leaf = findLeaf(currentTree, paneId)
    const tab = leaf?.active ? state.tabs[leaf.active] : undefined
    return tab ? (buffers[tab.bufferId] ?? null) : null
  }

  const putBuffer = (buffer: Buffer): void => {
    buffers = D.set(buffers, buffer.id, buffer)
    const next = metaOf(buffer)
    if (!sameMeta(state.buffers[buffer.id], next)) setState('buffers', buffer.id, next)
  }

  const onUpdate = (editorState: EditorState, view: EditorView): void => {
    const paneId = paneOfView(view)
    const buffer = paneId ? bufferInPane(paneId) : null
    if (!buffer || !paneId) return

    putBuffer({ ...buffer, state: editorState })
    if (paneId === state.activePane) setState('cursor', cursorPosition(editorState))
  }

  const setEditorFocus = (paneId: PaneId, focused: boolean): void => {
    if (focused) setState({ activePane: paneId, editorFocused: true })
    else if (state.activePane === paneId) setState('editorFocused', false)
  }

  const stateFor = (doc: string, languageId: string): EditorState =>
    makeState(doc, baseExtensions(languageById(languageId).load(), { onUpdate }))

  const activeLeaf = (): PaneLeaf => findLeaf(tree(), state.activePane) ?? (leaves(tree())[0] as PaneLeaf)

  const activeBuffer = (): Buffer | null => bufferInPane(state.activePane)

  const activeView = (): EditorView | null => views[state.activePane] ?? null

  const focusView = (paneId: PaneId): void => {
    setState('activePane', paneId)
    views[paneId]?.focus()
  }

  const addBufferTab = (buffer: Buffer): void => {
    const tab: Tab = { id: nextTabId(), kind: 'buffer', bufferId: buffer.id }
    putBuffer(buffer)
    setState('tabs', tab.id, tab)
    setTree(addTab(currentTree, state.activePane, tab.id))
  }

  const tabForPath = (path: string): { paneId: PaneId; tabId: TabId } | null => {
    const tab = D.values(state.tabs).find((t) => buffers[t.bufferId]?.meta?.path === path)
    const leaf = tab ? leafOfTab(currentTree, tab.id) : null
    return tab && leaf ? { paneId: leaf.id, tabId: tab.id } : null
  }

  const openFile = async (path: string): Promise<boolean> => {
    const existing = tabForPath(path)
    if (existing) {
      setTree(setActiveTab(currentTree, existing.paneId, existing.tabId))
      focusView(existing.paneId)
      return true
    }

    const result = await invoke('fs.open', { path })
    return R.match(
      result,
      (file: OpenedFile) => {
        addBufferTab(createBuffer(nextBufferId(), file, stateFor))
        setState('status', `opened ${file.path}`)
        return true
      },
      (error) => {
        setState('status', `open failed: ${error.message}`)
        return false
      },
    )
  }

  const newUntitled = (): void => addBufferTab(createBuffer(nextBufferId(), null, stateFor))

  const dropTab = (tabId: TabId): void => {
    const tab = state.tabs[tabId]
    if (!tab) return
    buffers = D.deleteKey(buffers, tab.bufferId)
    setTree(removeTab(currentTree, tabId))
    setState(
      produce((s) => {
        delete s.tabs[tabId]
        delete s.buffers[tab.bufferId]
      }),
    )
  }

  const saveBuffer = async (buffer: Buffer, mode: SaveMode, path: string): Promise<boolean> => {
    const encoding = buffer.meta?.encoding ?? 'utf8'
    const bom = buffer.meta?.bom ?? false
    const eol = buffer.meta?.eol ?? 'lf'

    const result = await invoke('fs.save', {
      path,
      text: buffer.state.doc.toString(),
      encoding,
      bom,
      eol,
      expectedHash: buffer.meta?.path === path ? buffer.meta.hash : null,
      mode,
    })

    return R.match(
      result,
      (saved) => {
        const meta: FileMeta = {
          path: saved.path,
          encoding,
          bom,
          eol,
          mixedEol: false,
          confidence: 'high',
          hash: saved.hash,
          mtimeMs: saved.mtimeMs,
          readonly: false,
          largeFile: buffer.meta?.largeFile ?? false,
        }
        putBuffer(markSaved(buffers[buffer.id] ?? buffer, meta))
        setState('status', `saved ${saved.bytes} bytes`)
        return true
      },
      (error) => {
        setState('status', describeSaveError(error))
        return false
      },
    )
  }

  const pickSavePath = async (current: string | null): Promise<string | null> => {
    const picked = await invoke('dialog.saveFile', current)
    return R.match(
      picked,
      (d) => d.path,
      () => null,
    )
  }

  const save = async (mode: SaveMode = 'normal'): Promise<void> => {
    const buffer = activeBuffer()
    if (!buffer) return
    const path = buffer.meta?.path ?? (await pickSavePath(null))
    if (path) await saveBuffer(buffer, mode, path)
  }

  const saveAs = async (): Promise<void> => {
    const buffer = activeBuffer()
    if (!buffer) return
    const path = await pickSavePath(buffer.meta?.path ?? null)
    if (path) await saveBuffer(buffer, 'overwrite', path)
  }

  const closeTab = async (tabId?: TabId): Promise<void> => {
    const target = tabId ?? activeLeaf().active
    const tab = target ? state.tabs[target] : undefined
    const buffer = tab ? buffers[tab.bufferId] : undefined
    if (!tab || !buffer) return

    if (isDirty(buffer)) {
      const choice = await confirmClose(titleOf(buffer))
      if (choice === 'cancel') return
      if (choice === 'save') {
        const path = buffer.meta?.path ?? (await pickSavePath(null))
        if (!path || !(await saveBuffer(buffer, 'normal', path))) return
      }
    }

    dropTab(tab.id)
  }

  const activateTab = (paneId: PaneId, tabId: TabId): void => {
    setTree(setActiveTab(currentTree, paneId, tabId))
    focusView(paneId)
  }

  const selectTabIndex = (n: number): void => {
    const leaf = activeLeaf()
    const tabId = leaf.tabs[n - 1]
    if (tabId) activateTab(leaf.id, tabId)
  }

  const cycleTab = (delta: 1 | -1): void => {
    const leaf = activeLeaf()
    if (leaf.tabs.length === 0 || !leaf.active) return
    const index = leaf.tabs.indexOf(leaf.active)
    const next = leaf.tabs[(index + delta + leaf.tabs.length) % leaf.tabs.length]
    if (next) activateTab(leaf.id, next)
  }

  const splitActive = (direction: 'row' | 'col'): void => {
    const fresh = nextPaneId()
    setTree(splitLeaf(currentTree, state.activePane, direction, fresh))
    setState('activePane', fresh)
  }

  const closeActivePane = (): void => {
    if (leaves(currentTree).length <= 1) return
    const closing = activeLeaf()
    const target = siblingLeaf(currentTree, closing.id, -1)
    setTree(closeLeaf(appendAll(currentTree, closing.tabs, target.id), closing.id))
    focusView(target.id)
  }

  const singlePane = (): void => {
    const all = leaves(currentTree)
    const first = all[0]
    if (!first || all.length === 1) return

    const others = all.slice(1)
    const merged = others.reduce((t, leaf) => appendAll(t, leaf.tabs, first.id), currentTree)
    setTree(others.reduce((t, leaf) => closeLeaf(t, leaf.id), merged))
    focusView(first.id)
  }

  const focusPaneIndex = (n: number): void => {
    const leaf = leaves(currentTree)[n - 1]
    if (leaf) focusView(leaf.id)
  }

  return {
    state,
    tree,
    setEditorFocus,
    getBuffer: (id) => buffers[id] ?? null,
    activeLeaf,
    activeBuffer,
    activeView,
    registerView: (paneId, view) => {
      views = D.set(views, paneId, view)
    },
    unregisterView: (paneId) => {
      views = D.deleteKey(views, paneId)
    },
    openFile,
    newUntitled,
    closeTab,
    activateTab,
    selectTabIndex,
    cycleTab,
    splitActive,
    closeActivePane,
    singlePane,
    focusPaneIndex,
    focusPane: focusView,
    resizeSplit: (splitId, sizes) => setTree(resizeSplitTree(currentTree, splitId, sizes)),
    save,
    saveAs,
    setStatus: (text) => setState('status', text),
  }
}
