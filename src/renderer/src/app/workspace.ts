import { historyField } from '@codemirror/commands'
import { closeSearchPanel, findNext, findPrevious, openSearchPanel, replaceAll, replaceNext, selectMatches, setSearchQuery } from '@codemirror/search'
import { indentUnit } from '@codemirror/language'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { A, D, R, pipe } from '@mobily/ts-belt'
import { createSignal, type Accessor } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import { type Settings, resolveForLanguage } from '@shared/config'
import type { EncodingName, Eol } from '@shared/encoding'
import { fnv1a32 } from '@shared/hash'
import type { DirtyEntry, OpenedFile, SaveError, TreeEntry } from '@shared/ipc'
import type { BufferTabSnapshot, LeafSnapshot, PaneSnapshot, TabSnapshot, WindowSnapshot } from '@shared/session'
import {
  type Buffer,
  type BufferId,
  type FileMeta,
  type Format,
  createBuffer,
  isDirty,
  markSaved,
  metaOfFile,
  replaceContents,
  titleOf,
  withFormat,
  withLanguage,
} from '../editor/buffers'
import { baseExtensions, makeState } from '../editor/createEditor'
import { cursorPosition, type CursorPosition } from '../editor/cursor'
import { configExtensions, cssFontFamily, settingsCompartment } from '../editor/editorConfig'
import { changeSetFromDiff, externalChangeAnnotation } from '../editor/externalChange'
import { buildQuery, countMatches, currentMatchIndex } from '../find/query'
import { replaceAllPreserving, replaceNextPreserving } from '../find/replace'
import { type FindSpec, defaultFindSpec, inSelectionField, setInSelectionRanges } from '../find/state'
import { themeCompartment } from '../theme/apply'
import { themeById } from '../theme/themes'
import { languageById } from '../editor/lang'
import { invoke, on } from '../ipc'
import { type TerminalRegistry, createTerminalRegistry } from '../terminal/registry'
import { xtermTheme } from '../terminal/theme'
import type { DirtySync } from './dirtySync'
import {
  addTab,
  closeLeaf,
  createLeaf,
  findLeaf,
  leafOfTab,
  leaves,
  moveTab,
  normalize,
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

export type Tab =
  | { readonly id: TabId; readonly kind: 'buffer'; readonly bufferId: BufferId; readonly preview?: boolean }
  | { readonly id: TabId; readonly kind: 'terminal'; readonly ptyId: string }
  | { readonly id: TabId; readonly kind: 'diff'; readonly bufferId: BufferId; readonly diskText: string; readonly bufferText: string; readonly title: string }

export type TerminalMeta = {
  readonly id: string
  readonly title: string
  readonly alive: boolean
  readonly exitCode: number | null
  readonly cwd: string
}
export type BufferMeta = {
  readonly id: BufferId
  readonly path: string | null
  readonly title: string
  readonly dirty: boolean
  readonly languageId: string
  readonly tabSize: number
  readonly insertSpaces: boolean
  readonly encoding: EncodingName
  readonly bom: boolean
  readonly eol: Eol
}
export type CloseChoice = 'save' | 'dontSave' | 'cancel'
export type SaveMode = 'normal' | 'overwrite'
export type Banner =
  | { readonly kind: 'conflict'; readonly diskHash: string }
  | { readonly kind: 'encodingLossy'; readonly positions: readonly number[] }
  | { readonly kind: 'readonly' }
  | { readonly kind: 'external'; readonly diskHash: string }
  | { readonly kind: 'deleted' }

export type WorkspaceState = {
  tabs: Record<TabId, Tab>
  buffers: Record<BufferId, BufferMeta>
  banners: Record<BufferId, Banner>
  terminals: Record<string, TerminalMeta>
  projectRoot: string | null
  windowId: string
  find: {
    open: boolean
    replaceOpen: boolean
    spec: FindSpec
    valid: boolean
    count: number
    capped: boolean
    current: number | null
    history: string[]
  }
  findFocused: boolean
  mru: string[]
  sidebar: { open: boolean; expanded: Record<string, true>; entries: Record<string, TreeEntry[]> }
  activePane: PaneId
  editorFocused: boolean
  terminalFocused: boolean
  cursor: CursorPosition
  status: string
}

export type Workspace = {
  readonly state: WorkspaceState
  readonly settings: Accessor<Settings>
  readonly tree: () => PaneNode
  readonly setEditorFocus: (paneId: PaneId, focused: boolean) => void
  readonly setTerminalFocus: (paneId: PaneId, focused: boolean) => void
  readonly terminalRegistry: TerminalRegistry
  readonly newTerminal: () => Promise<string | null>
  readonly restartTerminal: (ptyId: string) => Promise<void>
  readonly restartActiveTerminal: () => Promise<void>
  readonly sendToTerminal: (text: string) => Promise<void>
  readonly activeTerminalId: () => string | null
  readonly relativePath: (path: string) => string
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
  readonly applySettings: (next: Settings) => void
  readonly setEol: (eol: Eol) => void
  readonly setEncoding: (encoding: EncodingName, bom: boolean) => void
  readonly reinterpret: (encoding: EncodingName) => Promise<void>
  readonly setLanguage: (languageId: string) => void
  readonly setIndent: (tabSize: number, insertSpaces: boolean) => void
  readonly dismissBanner: (bufferId: BufferId) => void
  readonly reload: () => Promise<void>
  readonly saveAsUtf8: () => Promise<void>
  readonly restoreDirty: () => Promise<void>
  readonly keepMine: () => void
  readonly compareWithDisk: () => Promise<void>
  readonly recreateDeleted: () => Promise<void>
  readonly setProjectRoot: (root: string | null) => Promise<void>
  readonly setWindowId: (id: string) => void
  readonly snapshot: () => WindowSnapshot
  readonly restoreSession: (snapshot: WindowSnapshot, dirtyEntries: readonly DirtyEntry[]) => Promise<void>
  readonly previewFile: (path: string) => Promise<boolean>
  readonly commitPreview: () => void
  readonly cancelPreview: () => void
  readonly jumpTo: (pos: number) => void
  readonly gotoLine: (line: number, col: number | null) => void
  readonly openFind: (withReplace: boolean) => void
  readonly closeFind: () => void
  readonly setFindSpec: (patch: Partial<FindSpec>) => void
  readonly setFindFocus: (focused: boolean) => void
  readonly findNext: () => void
  readonly findPrevious: () => void
  readonly findSelectAll: () => void
  readonly replaceNext: () => void
  readonly replaceAll: () => void
  readonly toggleSidebar: () => void
  readonly expandDir: (dir: string) => Promise<void>
  readonly collapseDir: (dir: string) => void
  readonly refreshDir: (dir: string) => Promise<void>
  readonly createFileIn: (dir: string, name: string) => Promise<void>
  readonly renameEntry: (path: string, name: string) => Promise<void>
  readonly deleteEntry: (path: string) => Promise<void>
}

type Deps = {
  readonly confirmClose: (title: string) => Promise<CloseChoice>
  readonly settings: Accessor<Settings>
  readonly dirtySync: DirtySync
}

const bannerFor = (error: SaveError): Banner | null => {
  switch (error.kind) {
    case 'conflict':
      return { kind: 'conflict', diskHash: error.diskHash }
    case 'encodingLossy':
      return { kind: 'encodingLossy', positions: error.positions }
    case 'readonly':
      return { kind: 'readonly' }
    default:
      return null
  }
}

const metaOf = (buffer: Buffer): BufferMeta => ({
  id: buffer.id,
  path: buffer.meta?.path ?? null,
  title: titleOf(buffer),
  dirty: isDirty(buffer),
  languageId: buffer.languageId,
  tabSize: buffer.state.facet(EditorState.tabSize),
  insertSpaces: buffer.state.facet(indentUnit) !== '\t',
  encoding: buffer.format.encoding,
  bom: buffer.format.bom,
  eol: buffer.format.eol,
})

const sameMeta = (a: BufferMeta | undefined, b: BufferMeta): boolean =>
  a !== undefined &&
  a.dirty === b.dirty &&
  a.title === b.title &&
  a.path === b.path &&
  a.languageId === b.languageId &&
  a.tabSize === b.tabSize &&
  a.insertSpaces === b.insertSpaces &&
  a.encoding === b.encoding &&
  a.bom === b.bom &&
  a.eol === b.eol

const indentOverride = new Compartment()

const indentExtension = (tabSize: number, insertSpaces: boolean): Extension => [
  EditorState.tabSize.of(tabSize),
  indentUnit.of(insertSpaces ? ' '.repeat(tabSize) : '\t'),
]

const counter = (prefix: string) => {
  let n = 0
  return (): string => `${prefix}${(n += 1)}`
}

const appendAll = (tree: PaneNode, tabIds: readonly TabId[], toPaneId: PaneId): PaneNode =>
  tabIds.reduce((t, tabId) => moveTab(t, tabId, toPaneId, findLeaf(t, toPaneId)?.tabs.length ?? 0), tree)

export const createWorkspace = ({ confirmClose, settings, dirtySync }: Deps): Workspace => {
  const nextBufferId = counter('b')
  const nextTabId = counter('t')
  const nextPaneId = counter('p')

  const firstPane = nextPaneId()
  const [state, setState] = createStore<WorkspaceState>({
    tabs: {},
    buffers: {},
    banners: {},
    terminals: {},
    projectRoot: null,
    windowId: 'unknown',
    find: { open: false, replaceOpen: false, spec: defaultFindSpec, valid: false, count: 0, capped: false, current: null, history: [] },
    findFocused: false,
    mru: [],
    sidebar: { open: true, expanded: {}, entries: {} },
    activePane: firstPane,
    editorFocused: false,
    terminalFocused: false,
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

  const activeTabOf = (paneId: PaneId): Tab | undefined => {
    const leaf = findLeaf(currentTree, paneId)
    return leaf?.active ? state.tabs[leaf.active] : undefined
  }

  const bufferInPane = (paneId: PaneId): Buffer | null => {
    const tab = activeTabOf(paneId)
    return tab?.kind === 'buffer' ? (buffers[tab.bufferId] ?? null) : null
  }

  const dirtyEntry = (buffer: Buffer): DirtyEntry => ({
    id: `${state.windowId}:${buffer.id}`,
    path: buffer.meta?.path ?? null,
    text: buffer.state.doc.toString(),
    selection: { anchor: buffer.state.selection.main.anchor, head: buffer.state.selection.main.head },
  })

  const putBuffer = (buffer: Buffer): void => {
    const prev = buffers[buffer.id]
    buffers = D.set(buffers, buffer.id, buffer)
    const next = metaOf(buffer)
    if (!sameMeta(state.buffers[buffer.id], next)) setState('buffers', buffer.id, next)

    const docChanged = !prev || !prev.state.doc.eq(buffer.state.doc)
    const dirtyChanged = (prev ? isDirty(prev) : false) !== next.dirty
    if (docChanged || dirtyChanged) dirtySync.changed(dirtyEntry(buffer), next.dirty)
  }

  const onUpdate = (editorState: EditorState, view: EditorView, external: boolean): void => {
    const paneId = paneOfView(view)
    const buffer = paneId ? bufferInPane(paneId) : null
    if (!buffer || !paneId) return

    if (!external) putBuffer({ ...buffer, state: editorState })
    if (paneId === state.activePane) {
      setState('cursor', cursorPosition(editorState))
      if (state.find.open) refreshFindCount(editorState)
    }
  }

  const setEditorFocus = (paneId: PaneId, focused: boolean): void => {
    if (focused) setState({ activePane: paneId, editorFocused: true, terminalFocused: false })
    else if (state.activePane === paneId) setState('editorFocused', false)
  }

  const setTerminalFocus = (paneId: PaneId, focused: boolean): void => {
    if (focused) setState({ activePane: paneId, terminalFocused: true, editorFocused: false })
    else if (state.activePane === paneId) setState('terminalFocused', false)
  }

  const extensionsFor = (languageId: string): Extension => [
    baseExtensions(languageById(languageId).load(), { onUpdate }),
    indentOverride.of([]),
    settingsCompartment.of(configExtensions(resolveForLanguage(settings(), languageId))),
    themeCompartment.of(themeById(settings().theme).editor),
  ]

  const stateFor = (doc: string, languageId: string): EditorState => makeState(doc, extensionsFor(languageId))

  const untitledFormat = (): Format => ({
    encoding: settings().files.defaultEncoding,
    bom: false,
    eol: settings().files.defaultEol === 'crlf' ? 'crlf' : 'lf',
  })

  const viewShowing = (bufferId: BufferId): EditorView | null =>
    pipe(
      leaves(currentTree),
      A.find((leaf) => {
        const tab = leaf.active ? state.tabs[leaf.active] : undefined
        return tab?.kind === 'buffer' && tab.bufferId === bufferId
      }),
      (leaf) => (leaf ? (views[leaf.id] ?? null) : null),
    )

  const terminalOptions = (next: Settings = settings()) => ({
    theme: xtermTheme(themeById(next.theme)),
    fontFamily: cssFontFamily(next.editor.fontFamily),
    fontSize: next.editor.fontSize,
  })

  const applySettings = (next: Settings): void => {
    const options = terminalOptions(next)
    terminalRegistry.setTheme(options.theme)
    terminalRegistry.setFont(options.fontFamily, options.fontSize)
    D.values(buffers).forEach((buffer) => {
      const effects = [
        settingsCompartment.reconfigure(configExtensions(resolveForLanguage(next, buffer.languageId))),
        themeCompartment.reconfigure(themeById(next.theme).editor),
      ]
      const view = viewShowing(buffer.id)
      if (view) {
        view.dispatch({ effects })
        putBuffer({ ...buffer, state: view.state })
      } else {
        putBuffer({ ...buffer, state: buffer.state.update({ effects }).state })
      }
    })
  }

  const activeLeaf = (): PaneLeaf => findLeaf(tree(), state.activePane) ?? (leaves(tree())[0] as PaneLeaf)

  const activeBuffer = (): Buffer | null => bufferInPane(state.activePane)

  const activeView = (): EditorView | null => views[state.activePane] ?? null

  const focusView = (paneId: PaneId): void => {
    setState('activePane', paneId)
    views[paneId]?.focus()
  }

  const addTabToActive = (tab: Tab): void => {
    setState('tabs', tab.id, tab)
    setTree(addTab(currentTree, state.activePane, tab.id))
  }

  const addBufferTab = (buffer: Buffer): void => {
    putBuffer(buffer)
    addTabToActive({ id: nextTabId(), kind: 'buffer', bufferId: buffer.id })
  }

  const tabForPath = (path: string): { paneId: PaneId; tabId: TabId } | null => {
    const tab = D.values(state.tabs).find((t) => t.kind === 'buffer' && buffers[t.bufferId]?.meta?.path === path)
    const leaf = tab ? leafOfTab(currentTree, tab.id) : null
    return tab && leaf ? { paneId: leaf.id, tabId: tab.id } : null
  }

  const touchMru = (path: string): void =>
    setState('mru', [path, ...state.mru.filter((p) => p !== path)].slice(0, 50))

  const openFile = async (path: string): Promise<boolean> => {
    const existing = tabForPath(path)
    if (existing) {
      setTree(setActiveTab(currentTree, existing.paneId, existing.tabId))
      focusView(existing.paneId)
      touchMru(path)
      return true
    }

    const result = await invoke('fs.open', { path })
    return R.match(
      result,
      (file: OpenedFile) => {
        addBufferTab(createBuffer(nextBufferId(), file, stateFor, untitledFormat()))
        void invoke('fs.watch', { path: file.path })
        touchMru(file.path)
        setState('status', `opened ${file.path}`)
        return true
      },
      (error) => {
        setState('status', `open failed: ${error.message}`)
        return false
      },
    )
  }

  const newUntitled = (): void => addBufferTab(createBuffer(nextBufferId(), null, stateFor, untitledFormat()))

  const clearBanner = (bufferId: BufferId): void => {
    if (state.banners[bufferId]) {
      setState(
        produce((s) => {
          delete s.banners[bufferId]
        }),
      )
    }
  }

  const dropTab = (tabId: TabId): void => {
    const tab = state.tabs[tabId]
    if (!tab) return

    if (tab.kind === 'terminal') {
      void invoke('pty.kill', { id: tab.ptyId })
      terminalRegistry.dispose(tab.ptyId)
      setTree(removeTab(currentTree, tabId))
      setState(
        produce((s) => {
          delete s.tabs[tabId]
          delete s.terminals[tab.ptyId]
        }),
      )
      return
    }

    if (tab.kind === 'diff') {
      setTree(removeTab(currentTree, tabId))
      setState(
        produce((s) => {
          delete s.tabs[tabId]
        }),
      )
      return
    }

    const buffer = buffers[tab.bufferId]
    if (buffer) dirtySync.changed(dirtyEntry(buffer), false)
    if (buffer?.meta) void invoke('fs.unwatch', { path: buffer.meta.path })
    buffers = D.deleteKey(buffers, tab.bufferId)
    setTree(removeTab(currentTree, tabId))
    setState(
      produce((s) => {
        delete s.tabs[tabId]
        delete s.buffers[tab.bufferId]
        delete s.banners[tab.bufferId]
      }),
    )
  }

  const saveBuffer = async (buffer: Buffer, mode: SaveMode, path: string): Promise<boolean> => {
    const { encoding, bom, eol } = buffer.format

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
        clearBanner(buffer.id)
        setState('status', `saved ${saved.bytes} bytes`)
        return true
      },
      (error) => {
        const banner = bannerFor(error)
        if (banner) setState('banners', buffer.id, banner)
        else setState('status', `save failed: ${error.message}`)
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
    if (!tab) return

    if (tab.kind === 'terminal') {
      const term = state.terminals[tab.ptyId]
      if (term?.alive) {
        const choice = await confirmClose(term.title)
        if (choice === 'cancel') return
      }
      dropTab(tab.id)
      return
    }

    if (tab.kind === 'diff') {
      dropTab(tab.id)
      return
    }

    const buffer = buffers[tab.bufferId]
    if (!buffer) return

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

  const updateActive = (f: (buffer: Buffer) => Buffer): void => {
    const buffer = activeBuffer()
    if (!buffer) return
    const next = f(buffer)
    putBuffer(next)
    if (next.state !== buffer.state) viewShowing(buffer.id)?.setState(next.state)
  }

  const setEol = (eol: Eol): void => updateActive((b) => withFormat(b, { eol }))

  const setEncoding = (encoding: EncodingName, bom: boolean): void =>
    updateActive((b) => withFormat(b, { encoding, bom }))

  const setLanguage = (languageId: string): void => updateActive((b) => withLanguage(b, languageId, stateFor))

  const reinterpret = async (encoding: EncodingName): Promise<void> => {
    const buffer = activeBuffer()
    if (!buffer?.meta) return
    if (isDirty(buffer)) {
      setState('status', 'reinterpret needs a clean buffer: save or revert first')
      return
    }

    const result = await invoke('fs.open', { path: buffer.meta.path, encoding })
    R.match(
      result,
      (file) => updateActive((current) => replaceContents(current, file, stateFor)),
      (error) => setState('status', `reinterpret failed: ${error.message}`),
    )
  }

  const reload = async (): Promise<void> => {
    const buffer = activeBuffer()
    if (!buffer?.meta) return
    const result = await invoke('fs.open', { path: buffer.meta.path })
    R.match(
      result,
      (file) => {
        updateActive((current) => replaceContents(current, file, stateFor))
        clearBanner(buffer.id)
      },
      (error) => setState('status', `reload failed: ${error.message}`),
    )
  }

  const saveAsUtf8 = async (): Promise<void> => {
    setEncoding('utf8', false)
    await save('normal')
  }

  const replaceDocOfActive = (text: string, selection: DirtyEntry['selection']): void => {
    const buffer = activeBuffer()
    if (!buffer) return
    const clamp = (n: number): number => Math.min(n, text.length)
    const spec = {
      changes: { from: 0, to: buffer.state.doc.length, insert: text },
      selection: { anchor: clamp(selection.anchor), head: clamp(selection.head) },
    }
    const view = viewShowing(buffer.id)
    if (view) view.dispatch(spec)
    else putBuffer({ ...buffer, state: buffer.state.update(spec).state })
  }

  const restoreDirty = async (): Promise<void> => {
    const listed = await invoke('dirty.list', undefined)
    const entries = R.getWithDefault(listed, [] as DirtyEntry[])

    for (const entry of entries) {
      const opened = entry.path ? await openFile(entry.path) : false
      if (!opened) newUntitled()
      replaceDocOfActive(entry.text, entry.selection)
      await invoke('dirty.clear', entry.id)
    }
  }

  const setIndent = (tabSize: number, insertSpaces: boolean): void => {
    const buffer = activeBuffer()
    if (!buffer) return
    const effects = indentOverride.reconfigure(indentExtension(tabSize, insertSpaces))
    const view = viewShowing(buffer.id)
    if (view) {
      view.dispatch({ effects })
      putBuffer({ ...buffer, state: view.state })
    } else {
      putBuffer({ ...buffer, state: buffer.state.update({ effects }).state })
    }
  }

  const bufferByPath = (path: string): Buffer | null =>
    pipe(
      D.values(buffers),
      A.find((b) => b.meta?.path === path),
      (b) => b ?? null,
    )

  const applySilentReload = (buffer: Buffer, file: OpenedFile): void => {
    const spec = {
      changes: changeSetFromDiff(buffer.state.doc.toString(), file.text),
      annotations: externalChangeAnnotation.of(true),
    }
    const view = viewShowing(buffer.id)
    const nextState = view ? (view.dispatch(spec), view.state) : buffer.state.update(spec).state
    putBuffer(markSaved({ ...buffer, state: nextState }, metaOfFile(file)))
    clearBanner(buffer.id)
  }

  const handleExternalChange = async (path: string): Promise<void> => {
    const buffer = bufferByPath(path)
    if (!buffer) return

    const result = await invoke('fs.open', { path })
    R.tap(result, (file) => {
      const current = buffers[buffer.id]
      if (!current) return
      if (current.meta?.hash === file.hash) return
      if (!isDirty(current)) return applySilentReload(current, file)

      const kind = state.banners[current.id]?.kind === 'conflict' ? 'conflict' : 'external'
      setState('banners', current.id, { kind, diskHash: file.hash })
    })
  }

  on('fs.changed', ({ path }) => void handleExternalChange(path))
  on('fs.deleted', ({ path }) => {
    const buffer = bufferByPath(path)
    if (buffer) setState('banners', buffer.id, { kind: 'deleted' })
  })

  const keepMine = (): void => {
    const buffer = activeBuffer()
    const banner = buffer ? state.banners[buffer.id] : undefined
    if (!buffer?.meta || banner?.kind !== 'external') return
    putBuffer({ ...buffer, meta: { ...buffer.meta, hash: banner.diskHash } })
    clearBanner(buffer.id)
  }

  const compareWithDisk = async (): Promise<void> => {
    const buffer = activeBuffer()
    if (!buffer?.meta) return
    const result = await invoke('fs.open', { path: buffer.meta.path })
    R.tap(result, (file) => {
      addTabToActive({
        id: nextTabId(),
        kind: 'diff',
        bufferId: buffer.id,
        diskText: file.text,
        bufferText: buffer.state.doc.toString(),
        title: `${titleOf(buffer)} ↔ disk`,
      })
    })
  }

  const recreateDeleted = async (): Promise<void> => {
    const buffer = activeBuffer()
    if (!buffer?.meta) return
    if (await saveBuffer(buffer, 'overwrite', buffer.meta.path)) clearBanner(buffer.id)
  }

  const dirnameOf = (path: string): string | null => {
    const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    return index > 0 ? path.slice(0, index) : null
  }

  const isAbsolutePath = (path: string): boolean => /^([A-Za-z]:[\\/]|\/)/.test(path)

  const joinPath = (base: string, rel: string): string => {
    const separator = base.includes('\\') ? '\\' : '/'
    const parts = [...base.split(/[\\/]/), ...rel.split(/[\\/]/)].filter((p) => p !== '' && p !== '.')
    const resolved = parts.reduce<string[]>((acc, part) => (part === '..' ? acc.slice(0, -1) : [...acc, part]), [])
    return (base.startsWith('/') ? '/' : '') + resolved.join(separator)
  }

  const activeTerminalId = (): string | null => {
    const tab = activeTabOf(state.activePane)
    return tab?.kind === 'terminal' ? tab.ptyId : null
  }

  const lastLiveTerminalId = (): string | null =>
    pipe(
      D.values(state.terminals),
      A.filter((t) => t.alive),
      A.last,
      (t) => t?.id ?? null,
    )

  const openPathAt = async (path: string, line?: number, col?: number): Promise<void> => {
    const cwd = state.terminals[activeTerminalId() ?? lastLiveTerminalId() ?? '']?.cwd
    const absolute = isAbsolutePath(path) ? path : cwd ? joinPath(cwd, path) : path
    const opened = await openFile(absolute)
    const view = activeView()
    if (!opened || !view || !line) return

    const lineNo = Math.min(Math.max(1, line), view.state.doc.lines)
    const lineInfo = view.state.doc.line(lineNo)
    const pos = Math.min(lineInfo.from + Math.max(0, (col ?? 1) - 1), lineInfo.to)
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
  }

  let terminalCount = 0

  const terminalRegistry = createTerminalRegistry({
    onInput: (id, data) => void invoke('pty.write', { id, data }),
    onResize: (id, cols, rows) => void invoke('pty.resize', { id, cols, rows }),
    onAck: (id, bytes) => window.moru.send('pty.ack', { id, bytes }),
    openPath: (path, line, col) => void openPathAt(path, line, col),
    openUrl: (url) => void window.open(url),
  })

  on('pty.data', ({ id, data }) => terminalRegistry.write(id, data))
  on('pty.exit', ({ id, exitCode }) => {
    if (state.terminals[id]) setState('terminals', id, { alive: false, exitCode })
  })

  const spawnTerminal = async (cwd: string | null): Promise<{ id: string; cwd: string } | null> => {
    const result = await invoke('pty.spawn', { cwd, cols: 80, rows: 24 })
    return R.match(
      result,
      ({ id, cwd: dir }) => {
        terminalRegistry.create(id, terminalOptions())
        return { id, cwd: dir }
      },
      (error) => {
        setState('status', `terminal failed: ${error.message}`)
        return null
      },
    )
  }

  const newTerminal = async (): Promise<string | null> => {
    const activePath = activeBuffer()?.meta?.path
    const spawned = await spawnTerminal(state.projectRoot ?? (activePath ? dirnameOf(activePath) : null))
    if (!spawned) return null

    terminalCount += 1
    setState('terminals', spawned.id, {
      id: spawned.id,
      title: `Terminal ${terminalCount}`,
      alive: true,
      exitCode: null,
      cwd: spawned.cwd,
    })
    addTabToActive({ id: nextTabId(), kind: 'terminal', ptyId: spawned.id })
    return spawned.id
  }

  const restartTerminal = async (ptyId: string): Promise<void> => {
    const old = state.terminals[ptyId]
    const tab = D.values(state.tabs).find((t) => t.kind === 'terminal' && t.ptyId === ptyId)
    if (!old || !tab) return

    const spawned = await spawnTerminal(old.cwd)
    if (!spawned) return

    void invoke('pty.kill', { id: ptyId })
    terminalRegistry.dispose(ptyId)
    setState(
      produce((s) => {
        delete s.terminals[ptyId]
        s.terminals[spawned.id] = { id: spawned.id, title: old.title, alive: true, exitCode: null, cwd: spawned.cwd }
        s.tabs[tab.id] = { id: tab.id, kind: 'terminal', ptyId: spawned.id }
      }),
    )
  }

  const restartActiveTerminal = async (): Promise<void> => {
    const id = activeTerminalId()
    if (id) await restartTerminal(id)
  }

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  const sendToTerminal = async (text: string): Promise<void> => {
    const existing = activeTerminalId() ?? lastLiveTerminalId()
    const id = existing ?? (await newTerminal())
    if (!id) return
    if (!existing) await sleep(400)
    await invoke('pty.write', { id, data: text })
  }

  const relativePath = (path: string): string => {
    const base = state.projectRoot ?? state.terminals[activeTerminalId() ?? lastLiveTerminalId() ?? '']?.cwd
    return base && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
  }

  const joinName = (dir: string, name: string): string => `${dir}${dir.includes('\\') ? '\\' : '/'}${name}`

  const refreshDir = async (dir: string): Promise<void> => {
    const result = await invoke('fs.tree', { dir })
    R.match(
      result,
      (entries) => setState('sidebar', 'entries', dir, entries),
      (error) => setState('status', `folder failed: ${error.message}`),
    )
  }

  const expandDir = async (dir: string): Promise<void> => {
    setState('sidebar', 'expanded', dir, true)
    await refreshDir(dir)
  }

  const collapseDir = (dir: string): void => {
    setState(
      produce((s) => {
        delete s.sidebar.expanded[dir]
      }),
    )
  }

  const setProjectRoot = async (root: string | null): Promise<void> => {
    setState('projectRoot', root)
    setState('sidebar', { open: state.sidebar.open, expanded: {}, entries: {} })
    if (root) await refreshDir(root)
  }

  const toggleSidebar = (): void => setState('sidebar', 'open', !state.sidebar.open)

  const parentDir = (path: string): string => dirnameOf(path) ?? path

  const createFileIn = async (dir: string, name: string): Promise<void> => {
    const path = joinName(dir, name)
    const result = await invoke('fs.create', { path })
    await R.match(
      result,
      async () => {
        await refreshDir(dir)
        await openFile(path)
      },
      async (error) => setState('status', `create failed: ${error.message}`),
    )
  }

  const retargetBuffers = (from: string, to: string): void => {
    D.values(buffers).forEach((buffer) => {
      const path = buffer.meta?.path
      if (!buffer.meta || !path) return
      if (path === from) putBuffer({ ...buffer, meta: { ...buffer.meta, path: to } })
      else if (path.startsWith(`${from}/`)) putBuffer({ ...buffer, meta: { ...buffer.meta, path: to + path.slice(from.length) } })
    })
  }

  const renameEntry = async (path: string, name: string): Promise<void> => {
    const to = joinName(parentDir(path), name)
    const result = await invoke('fs.rename', { from: path, to })
    await R.match(
      result,
      async () => {
        retargetBuffers(path, to)
        await refreshDir(parentDir(path))
      },
      async (error) => setState('status', `rename failed: ${error.message}`),
    )
  }

  const deleteEntry = async (path: string): Promise<void> => {
    const result = await invoke('fs.delete', { path })
    await R.match(
      result,
      async () => refreshDir(parentDir(path)),
      async (error) => setState('status', `delete failed: ${error.message}`),
    )
  }

  let previewOrigin: { paneId: PaneId; tabId: TabId | null } | null = null

  const previewTabId = (): TabId | null => D.values(state.tabs).find((t) => t.kind === 'buffer' && t.preview)?.id ?? null

  const previewFile = async (path: string): Promise<boolean> => {
    const alreadyOpen = tabForPath(path)
    if (alreadyOpen) {
      if (!previewOrigin) previewOrigin = { paneId: state.activePane, tabId: activeLeaf().active }
      setTree(setActiveTab(currentTree, alreadyOpen.paneId, alreadyOpen.tabId))
      return true
    }

    if (!previewOrigin) previewOrigin = { paneId: state.activePane, tabId: activeLeaf().active }
    const previous = previewTabId()
    if (previous) dropTab(previous)

    const opened = await openFile(path)
    const leaf = activeLeaf()
    const tab = leaf.active ? state.tabs[leaf.active] : undefined
    if (opened && tab?.kind === 'buffer') setState('tabs', tab.id, { ...tab, preview: true })
    return opened
  }

  const commitPreview = (): void => {
    const id = previewTabId()
    const tab = id ? state.tabs[id] : undefined
    if (tab?.kind === 'buffer') setState('tabs', tab.id, { ...tab, preview: false })
    previewOrigin = null
  }

  const cancelPreview = (): void => {
    const id = previewTabId()
    if (id) dropTab(id)
    if (previewOrigin) {
      const { paneId, tabId } = previewOrigin
      if (tabId && findLeaf(currentTree, paneId)?.tabs.includes(tabId)) setTree(setActiveTab(currentTree, paneId, tabId))
      focusView(findLeaf(currentTree, paneId) ? paneId : state.activePane)
    }
    previewOrigin = null
  }

  const jumpTo = (pos: number): void => {
    const view = activeView()
    if (!view) return
    const clamped = Math.min(Math.max(0, pos), view.state.doc.length)
    view.dispatch({ selection: { anchor: clamped }, scrollIntoView: true })
  }

  const gotoLine = (line: number, col: number | null): void => {
    const view = activeView()
    if (!view) return
    const lineNo = Math.min(Math.max(1, line), view.state.doc.lines)
    const info = view.state.doc.line(lineNo)
    jumpTo(Math.min(info.from + Math.max(0, (col ?? 1) - 1), info.to))
  }

  const activeQuery = (editorState?: EditorState) => {
    const view = activeView()
    const st = editorState ?? view?.state
    if (!st) return null
    return buildQuery(state.find.spec, st.field(inSelectionField, false) ?? null)
  }

  const refreshFindCount = (editorState?: EditorState): void => {
    const view = activeView()
    const st = editorState ?? view?.state
    const q = activeQuery(st)
    if (!st || !q) return
    const { count, capped } = countMatches(q, st)
    setState('find', { valid: q.valid, count, capped, current: currentMatchIndex(q, st) })
  }

  const applyFindQuery = (): void => {
    const view = activeView()
    const q = activeQuery()
    if (!view || !q) return
    view.dispatch({ effects: setSearchQuery.of(q) })
    refreshFindCount(view.state)
  }

  const captureSelectionRanges = (view: EditorView): void => {
    const ranges = view.state.selection.ranges.filter((r) => !r.empty).map((r) => ({ from: r.from, to: r.to }))
    view.dispatch({ effects: setInSelectionRanges.of(ranges.length > 0 ? ranges : null) })
  }

  const openFind = (withReplace: boolean): void => {
    const view = activeView()
    if (!view) return
    const main = view.state.selection.main
    const selected = view.state.sliceDoc(main.from, main.to)
    const seed = !main.empty && !selected.includes('\n') ? selected : state.find.spec.search
    setState('find', {
      open: true,
      replaceOpen: withReplace || state.find.replaceOpen,
      spec: { ...state.find.spec, search: seed },
    })
    if (state.find.spec.inSelection) captureSelectionRanges(view)
    openSearchPanel(view)
    applyFindQuery()
  }

  const closeFind = (): void => {
    const view = activeView()
    setState('find', 'open', false)
    setState('findFocused', false)
    if (view) {
      closeSearchPanel(view)
      view.focus()
    }
  }

  const setFindSpec = (patch: Partial<FindSpec>): void => {
    const view = activeView()
    if (view && patch.inSelection === true) captureSelectionRanges(view)
    if (view && patch.inSelection === false) view.dispatch({ effects: setInSelectionRanges.of(null) })
    setState('find', 'spec', { ...state.find.spec, ...patch })
    applyFindQuery()
  }

  const pushFindHistory = (): void => {
    const term = state.find.spec.search
    if (term.length === 0) return
    setState('find', 'history', [term, ...state.find.history.filter((t) => t !== term)].slice(0, 20))
  }

  const findStep = (delta: 1 | -1): void => {
    const view = activeView()
    if (!view) return
    applyFindQuery()
    const { count, current } = state.find
    const atEdge = current !== null && (delta === 1 ? current === count : current === 1)
    if (!state.find.spec.wrap && atEdge) return
    if (delta === 1) findNext(view)
    else findPrevious(view)
    pushFindHistory()
    refreshFindCount(view.state)
  }

  const findSelectAll = (): void => {
    const view = activeView()
    if (!view) return
    applyFindQuery()
    selectMatches(view)
    pushFindHistory()
    closeFind()
  }

  const replaceNextCmd = (): void => {
    const view = activeView()
    const q = activeQuery()
    if (!view || !q || !q.valid) return
    if (state.find.spec.preserveCase) {
      const spec = replaceNextPreserving(view.state, q, true)
      if (spec) view.dispatch(spec)
    } else {
      applyFindQuery()
      replaceNext(view)
    }
    pushFindHistory()
    refreshFindCount(view.state)
  }

  const replaceAllCmd = (): void => {
    const view = activeView()
    const q = activeQuery()
    if (!view || !q || !q.valid) return
    if (state.find.spec.preserveCase) {
      const spec = replaceAllPreserving(view.state, q, true)
      if (spec) view.dispatch(spec)
    } else {
      applyFindQuery()
      replaceAll(view)
    }
    pushFindHistory()
    refreshFindCount(view.state)
  }

  const historyLimitChars = 1_000_000

  const bufferSnapshot = (buffer: Buffer): BufferTabSnapshot => {
    const doc = buffer.state.doc.toString()
    const json = doc.length <= historyLimitChars ? (buffer.state.toJSON({ history: historyField }) as { history?: unknown }) : {}
    return {
      kind: 'buffer',
      path: buffer.meta?.path ?? null,
      dirtyId: `${state.windowId}:${buffer.id}`,
      format: buffer.format,
      hash: buffer.meta?.hash ?? null,
      docHash: fnv1a32(doc),
      selection: { anchor: buffer.state.selection.main.anchor, head: buffer.state.selection.main.head },
      scrollTop: viewShowing(buffer.id)?.scrollDOM.scrollTop ?? 0,
      history: json.history ?? null,
      languageId: buffer.languageId,
    }
  }

  const tabSnapshot = (tabId: TabId): TabSnapshot | null => {
    const tab = state.tabs[tabId]
    if (!tab) return null
    if (tab.kind === 'buffer') {
      if (tab.preview) return null
      const buffer = buffers[tab.bufferId]
      return buffer ? bufferSnapshot(buffer) : null
    }
    if (tab.kind === 'terminal') {
      const term = state.terminals[tab.ptyId]
      return term ? { kind: 'terminal', cwd: term.cwd, title: term.title } : null
    }
    return null
  }

  const paneSnapshot = (node: PaneNode): PaneSnapshot => {
    if (node.kind === 'split') {
      return { kind: 'split', direction: node.direction, sizes: [...node.sizes], children: node.children.map(paneSnapshot) }
    }
    const kept = node.tabs.map((id) => ({ id, snap: tabSnapshot(id) })).filter((t) => t.snap !== null)
    const activeIndex = kept.findIndex((t) => t.id === node.active)
    return { kind: 'leaf', tabs: kept.map((t) => t.snap as TabSnapshot), active: activeIndex >= 0 ? activeIndex : kept.length > 0 ? 0 : null }
  }

  const pathToLeaf = (node: PaneNode, paneId: PaneId): number[] | null => {
    if (node.kind === 'leaf') return node.id === paneId ? [] : null
    for (const [i, child] of node.children.entries()) {
      const sub = pathToLeaf(child, paneId)
      if (sub) return [i, ...sub]
    }
    return null
  }

  const snapshot = (): WindowSnapshot => ({
    windowId: state.windowId,
    projectRoot: state.projectRoot,
    sidebar: { open: state.sidebar.open, expanded: Object.keys(state.sidebar.expanded) },
    layout: paneSnapshot(currentTree),
    activePath: pathToLeaf(currentTree, state.activePane) ?? [],
    findHistory: [...state.find.history],
    recentFiles: [...state.mru],
  })

  const treeFromSnapshot = (snap: PaneSnapshot): { tree: PaneNode; leaves: { id: PaneId; snap: LeafSnapshot }[] } => {
    if (snap.kind === 'leaf') {
      const id = nextPaneId()
      return { tree: createLeaf(id), leaves: [{ id, snap }] }
    }
    const children = snap.children.map(treeFromSnapshot)
    const sizes = children.length === snap.sizes.length ? normalize(snap.sizes) : normalize(children.map(() => 1))
    return {
      tree: { kind: 'split', id: `split:${nextPaneId()}`, direction: snap.direction, children: children.map((c) => c.tree), sizes },
      leaves: children.flatMap((c) => c.leaves),
    }
  }

  const stateFromSnapshot = (text: string, languageId: string, snap: BufferTabSnapshot): EditorState => {
    const useHistory = snap.history !== null && fnv1a32(text) === snap.docHash
    const clamp = (n: number): number => Math.min(n, text.length)
    const json = {
      doc: text,
      selection: { ranges: [{ anchor: clamp(snap.selection.anchor), head: clamp(snap.selection.head) }], main: 0 },
      ...(useHistory ? { history: snap.history } : {}),
    }
    return EditorState.fromJSON(json, { extensions: extensionsFor(languageId) }, useHistory ? { history: historyField } : {})
  }

  const restoreBufferTab = async (snap: BufferTabSnapshot, dirty: DirtyEntry | undefined): Promise<void> => {
    if (snap.path === null) {
      if (!dirty) return
      const buffer = createBuffer(nextBufferId(), null, stateFor, untitledFormat())
      addBufferTab({ ...buffer, state: stateFromSnapshot(dirty.text, 'plain', snap) })
      return
    }

    const result = await invoke('fs.open', { path: snap.path })
    await R.match(
      result,
      async (file) => {
        const text = dirty?.text ?? file.text
        const base = createBuffer(nextBufferId(), file, stateFor, untitledFormat())
        const restored: Buffer = { ...base, state: stateFromSnapshot(text, base.languageId, snap), format: snap.format }
        addBufferTab(restored)
        void invoke('fs.watch', { path: file.path })
        if (dirty && snap.hash !== null && snap.hash !== file.hash) setState('banners', restored.id, { kind: 'external', diskHash: file.hash })
      },
      async () => {
        if (!dirty) return
        const buffer = createBuffer(nextBufferId(), null, stateFor, untitledFormat())
        addBufferTab({ ...buffer, state: stateFromSnapshot(dirty.text, 'plain', snap) })
      },
    )
  }

  const restoreTerminalTab = async (snap: { cwd: string; title: string }): Promise<void> => {
    const spawned = await spawnTerminal(snap.cwd)
    if (!spawned) return
    terminalCount += 1
    setState('terminals', spawned.id, { id: spawned.id, title: snap.title, alive: true, exitCode: null, cwd: spawned.cwd })
    addTabToActive({ id: nextTabId(), kind: 'terminal', ptyId: spawned.id })
  }

  const restoreSession = async (snap: WindowSnapshot, dirtyEntries: readonly DirtyEntry[]): Promise<void> => {
    const dirtyById = Object.fromEntries(dirtyEntries.map((e) => [e.id, e]))
    const { tree: built, leaves: leafSnaps } = treeFromSnapshot(snap.layout)
    setTree(built)

    for (const leaf of leafSnaps) {
      setState('activePane', leaf.id)
      for (const tabSnap of leaf.snap.tabs) {
        if (tabSnap.kind === 'buffer') await restoreBufferTab(tabSnap, dirtyById[tabSnap.dirtyId])
        else await restoreTerminalTab(tabSnap)
      }
      const restoredLeaf = findLeaf(currentTree, leaf.id)
      const activeTab = restoredLeaf && leaf.snap.active !== null ? restoredLeaf.tabs[leaf.snap.active] : undefined
      if (restoredLeaf && activeTab) setTree(setActiveTab(currentTree, leaf.id, activeTab))
    }

    for (const entry of dirtyEntries) await invoke('dirty.clear', entry.id)

    setState('sidebar', 'open', snap.sidebar.open)
    if (snap.findHistory) setState('find', 'history', [...snap.findHistory])
    if (snap.recentFiles) setState('mru', [...snap.recentFiles])
    for (const dir of snap.sidebar.expanded) await expandDir(dir)

    const targetLeaf = leafAtPath(currentTree, snap.activePath) ?? leaves(currentTree)[0]
    if (targetLeaf) focusView(targetLeaf.id)
  }

  const leafAtPath = (node: PaneNode, path: readonly number[]): PaneLeaf | null => {
    if (node.kind === 'leaf') return path.length === 0 ? node : null
    const [head, ...rest] = path
    const child = head === undefined ? undefined : node.children[head]
    return child ? leafAtPath(child, rest) : null
  }

  const focusPaneIndex = (n: number): void => {
    const leaf = leaves(currentTree)[n - 1]
    if (leaf) focusView(leaf.id)
  }

  return {
    state,
    settings,
    tree,
    setEditorFocus,
    setTerminalFocus,
    terminalRegistry,
    newTerminal,
    restartTerminal,
    restartActiveTerminal,
    sendToTerminal,
    activeTerminalId,
    relativePath,
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
    applySettings,
    setEol,
    setEncoding,
    reinterpret,
    setLanguage,
    setIndent,
    dismissBanner: clearBanner,
    reload,
    saveAsUtf8,
    restoreDirty,
    keepMine,
    compareWithDisk,
    recreateDeleted,
    setProjectRoot,
    setWindowId: (id) => setState('windowId', id),
    snapshot,
    restoreSession,
    previewFile,
    commitPreview,
    cancelPreview,
    jumpTo,
    gotoLine,
    openFind,
    closeFind,
    setFindSpec,
    setFindFocus: (focused) => setState('findFocused', focused),
    findNext: () => findStep(1),
    findPrevious: () => findStep(-1),
    findSelectAll,
    replaceNext: replaceNextCmd,
    replaceAll: replaceAllCmd,
    toggleSidebar,
    expandDir,
    collapseDir,
    refreshDir,
    createFileIn,
    renameEntry,
    deleteEntry,
  }
}
