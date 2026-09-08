import { For } from 'solid-js'
import type { Workspace } from '../../app/workspace'
import type { PaneLeaf } from '../layout/paneTree'

type Props = { readonly ws: Workspace; readonly leaf: () => PaneLeaf }

export const TabStrip = (props: Props) => (
  <div class="tabs" role="tablist">
    <For each={props.leaf().tabs}>
      {(tabId) => {
        const tab = () => props.ws.state.tabs[tabId]
        const meta = () => {
          const t = tab()
          return t?.kind === 'buffer' ? props.ws.state.buffers[t.bufferId] : undefined
        }
        const title = () => {
          const t = tab()
          if (t?.kind === 'terminal') return props.ws.state.terminals[t.ptyId]?.title ?? 'Terminal'
          if (t?.kind === 'diff') return t.title
          return meta()?.title ?? ''
        }
        return (
          <div
            class="tab"
            role="tab"
            classList={{ active: props.leaf().active === tabId, dirty: meta()?.dirty ?? false }}
            title={meta()?.path ?? title()}
            onMouseDown={(e) => {
              if (e.button === 1) void props.ws.closeTab(tabId)
              else props.ws.activateTab(props.leaf().id, tabId)
            }}
          >
            <span class="tab-title">{title()}</span>
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
