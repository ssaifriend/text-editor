import { MergeView } from '@codemirror/merge'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { onCleanup, onMount } from 'solid-js'

type Props = { readonly diskText: string; readonly bufferText: string; readonly theme: Extension }

export const DiffHost = (props: Props) => {
  let host!: HTMLDivElement

  onMount(() => {
    const readOnly: Extension = [EditorState.readOnly.of(true), EditorView.editable.of(false), props.theme]
    const view = new MergeView({
      a: { doc: props.diskText, extensions: readOnly },
      b: { doc: props.bufferText, extensions: readOnly },
      parent: host,
      highlightChanges: true,
      gutter: true,
    })
    onCleanup(() => view.destroy())
  })

  return <div class="diff-host" ref={host} />
}
