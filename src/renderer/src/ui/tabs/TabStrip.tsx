import { For } from 'solid-js'
import type { Workspace } from '../../app/workspace'
import type { PaneLeaf } from '../layout/paneTree'

type Props = { readonly ws: Workspace; readonly leaf: () => PaneLeaf }

export const TabStrip = (props: Props) => (
  <div class="tabs" role="tablist">
    <For each={props.leaf().tabs}>
      {(tabId) => {
        const meta = () => {
          const tab = props.ws.state.tabs[tabId]
          return tab ? props.ws.state.buffers[tab.bufferId] : undefined
        }
        return (
          <div
            class="tab"
            role="tab"
            classList={{ active: props.leaf().active === tabId, dirty: meta()?.dirty ?? false }}
            title={meta()?.path ?? 'untitled'}
            onMouseDown={(e) => {
              if (e.button === 1) void props.ws.closeTab(tabId)
              else props.ws.activateTab(props.leaf().id, tabId)
            }}
          >
            <span class="tab-title">{meta()?.title ?? ''}</span>
            <span class="tab-dirty">●</span>
            <button
              class="tab-close"
              aria-label="Close tab"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                void props.ws.closeTab(tabId)
              }}
            >
              ×
            </button>
          </div>
        )
      }}
    </For>
  </div>
)
