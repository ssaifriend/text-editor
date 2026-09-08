import { EditorState } from '@codemirror/state'
import { createEffect, on, onCleanup, onMount } from 'solid-js'
import type { Workspace } from '../../app/workspace'
import { createView } from '../../editor/createEditor'
import type { PaneLeaf } from '../layout/paneTree'

type Props = { readonly ws: Workspace; readonly leaf: () => PaneLeaf }

const emptyState = (): EditorState => EditorState.create({ doc: '', extensions: [EditorState.readOnly.of(true)] })

export const EditorHost = (props: Props) => {
  let host!: HTMLDivElement

  onMount(() => {
    const view = createView(host, emptyState())

    createEffect(
      on(
        () => props.leaf().id,
        (id, prev) => {
          if (prev !== undefined && prev !== id) props.ws.unregisterView(prev)
          props.ws.registerView(id, view)
        },
      ),
    )

    createEffect(
      on(
        () => {
          const leaf = props.leaf()
          const tab = leaf.active ? props.ws.state.tabs[leaf.active] : undefined
          return tab?.kind === 'buffer' ? tab.bufferId : null
        },
        (bufferId) => {
          const buffer = bufferId ? props.ws.getBuffer(bufferId) : null
          view.setState(buffer ? buffer.state : emptyState())
        },
      ),
    )

    onCleanup(() => {
      props.ws.unregisterView(props.leaf().id)
      view.destroy()
    })
  })

  return (
    <div
      class="editor-host"
      ref={host}
      onMouseDown={() => props.ws.focusPane(props.leaf().id)}
      onFocusIn={() => props.ws.setEditorFocus(props.leaf().id, true)}
      onFocusOut={() => props.ws.setEditorFocus(props.leaf().id, false)}
    />
  )
}
