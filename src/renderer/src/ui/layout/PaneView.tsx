import { For, Show } from 'solid-js'
import type { Workspace } from '../../app/workspace'
import { EditorHost } from '../editor/EditorHost'
import { TabStrip } from '../tabs/TabStrip'
import type { PaneLeaf, PaneNode, PaneSplit } from './paneTree'
import { SplitGutter } from './SplitGutter'

type Props = { readonly ws: Workspace; readonly node: () => PaneNode }

const LeafView = (props: { ws: Workspace; leaf: () => PaneLeaf }) => (
  <div
    class="pane"
    classList={{ active: props.ws.state.activePane === props.leaf().id }}
    data-pane-id={props.leaf().id}
  >
    <TabStrip ws={props.ws} leaf={props.leaf} />
    <EditorHost ws={props.ws} leaf={props.leaf} />
  </div>
)

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
