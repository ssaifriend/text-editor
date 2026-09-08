import { For, Show } from 'solid-js'
import type { Workspace } from '../../app/workspace'
import { Banner } from '../banner/Banner'
import { EditorHost } from '../editor/EditorHost'
import { FindPanel } from '../find/FindPanel'
import { TabStrip } from '../tabs/TabStrip'
import { TerminalHost } from '../terminal/TerminalHost'
import { DiffHost } from '../diff/DiffHost'
import { SearchHost } from '../search/SearchHost'
import { PreviewHost } from '../preview/PreviewHost'
import { themeById } from '../../theme/themes'
import type { PaneLeaf, PaneNode, PaneSplit } from './paneTree'
import { SplitGutter } from './SplitGutter'

type Props = { readonly ws: Workspace; readonly node: () => PaneNode }

const LeafView = (props: { ws: Workspace; leaf: () => PaneLeaf }) => {
  const activeTab = () => {
    const active = props.leaf().active
    return active ? props.ws.state.tabs[active] : undefined
  }
  const terminalId = (): string | null => {
    const tab = activeTab()
    return tab?.kind === 'terminal' ? tab.ptyId : null
  }
  const diffTab = () => {
    const tab = activeTab()
    return tab?.kind === 'diff' ? tab : null
  }
  const searchTab = () => {
    const tab = activeTab()
    return tab?.kind === 'search' ? tab : null
  }
  const previewTab = () => {
    const tab = activeTab()
    return tab?.kind === 'preview' ? tab : null
  }
  const editorHidden = () => terminalId() !== null || diffTab() !== null || searchTab() !== null || previewTab() !== null

  return (
    <div
      class="pane"
      classList={{ active: props.ws.state.activePane === props.leaf().id }}
      data-pane-id={props.leaf().id}
    >
      <TabStrip ws={props.ws} leaf={props.leaf} />
      <Banner ws={props.ws} leaf={props.leaf} />
      <div class="editor-host-wrap" classList={{ hidden: editorHidden() }}>
        <EditorHost ws={props.ws} leaf={props.leaf} />
      </div>
      <Show when={terminalId()}>{(id) => <TerminalHost ws={props.ws} leaf={props.leaf} ptyId={id} />}</Show>
      <Show when={diffTab()}>
        {(tab) => (
          <DiffHost
            diskText={tab().diskText}
            bufferText={tab().bufferText}
            theme={themeById(props.ws.settings().theme).editor}
          />
        )}
      </Show>
      <Show when={searchTab()} keyed>
        {(tab) => <SearchHost ws={props.ws} searchId={tab.searchId} />}
      </Show>
      <Show when={previewTab()} keyed>
        {(tab) => <PreviewHost ws={props.ws} bufferId={tab.bufferId} />}
      </Show>
      <Show when={props.ws.state.activePane === props.leaf().id && !editorHidden()}>
        <FindPanel ws={props.ws} />
      </Show>
    </div>
  )
}

const SplitView = (props: { ws: Workspace; split: () => PaneSplit }) => {
  let container!: HTMLDivElement

  const resize = (index: number, deltaPx: number): void => {
    const split = props.split()
    const total = split.direction === 'row' ? container.clientWidth : container.clientHeight
    if (total === 0) return
    const delta = deltaPx / total
    const sizes = split.sizes.map((s, i) => (i === index ? s + delta : i === index + 1 ? s - delta : s))
    if (sizes.every((s) => s > 0.05)) props.ws.resizeSplit(split.id, sizes)
  }

  return (
    <div
      class="split"
      classList={{ row: props.split().direction === 'row', col: props.split().direction === 'col' }}
      ref={container}
    >
      <For each={props.split().children}>
        {(child, index) => (
          <>
            <Show when={index() > 0}>
              <SplitGutter direction={props.split().direction} onDrag={(d) => resize(index() - 1, d)} />
            </Show>
            <div class="split-child" style={{ flex: `${props.split().sizes[index()] ?? 1} 1 0px` }}>
              <PaneView ws={props.ws} node={() => child} />
            </div>
          </>
        )}
      </For>
    </div>
  )
}

export const PaneView = (props: Props) => (
  <Show
    when={props.node().kind === 'split'}
    fallback={<LeafView ws={props.ws} leaf={() => props.node() as PaneLeaf} />}
  >
    <SplitView ws={props.ws} split={() => props.node() as PaneSplit} />
  </Show>
)
