import { createSignal, onMount } from 'solid-js'
import { R } from '@mobily/ts-belt'
import { channels } from '@shared/channels'
import { createEditor, type Editor } from './editor/createEditor'
import { cursorPosition, type CursorPosition } from './editor/cursor'
import { languageFor } from './editor/lang'
import { invoke } from './ipc'
import { installTestHooks } from './testHooks'

export const App = () => {
  const [path, setPath] = createSignal<string | null>(null)
  const [pos, setPos] = createSignal<CursorPosition>({ line: 1, col: 1 })
  const [status, setStatus] = createSignal('')

  let host!: HTMLDivElement
  let editor!: Editor

  const openPath = async (target: string): Promise<void> => {
    const result = await invoke('fs.open', target)

    R.match(
      result,
      (file) => {
        editor.setDoc(file.text, languageFor(file.path))
        setPath(file.path)
        setStatus(`opened ${file.path}`)
      },
      (error) => setStatus(`open failed: ${error.message}`),
    )
  }

  const open = async (): Promise<void> => {
    const picked = await invoke('dialog.openFile', undefined)
    R.tap(picked, ({ path: target }) => {
      if (target) void openPath(target)
    })
  }

  const pickSavePath = async (): Promise<string | null> => {
    const picked = await invoke('dialog.saveFile', path())
    return R.match(picked, (d) => d.path, () => null)
  }

  const save = async (): Promise<void> => {
    const target = path() ?? (await pickSavePath())
    if (!target) return

    const result = await invoke('fs.save', { path: target, text: editor.view.state.doc.toString() })

    R.match(
      result,
      (meta) => {
        setPath(meta.path)
        setStatus(`saved ${meta.bytes} bytes`)
      },
      (error) => setStatus(`save failed: ${error.message}`),
    )
  }

  onMount(async () => {
    editor = createEditor(host, (state) => setPos(cursorPosition(state)))
    requestAnimationFrame(() => window.moru.send(channels.perfFirstPaint, undefined))

    const bootstrap = await invoke('app.bootstrap', undefined)
    R.tap(bootstrap, ({ path: initial, test }) => {
      if (test) installTestHooks(editor, path)
      if (initial) void openPath(initial)
    })
  })

  return (
    <div class="app">
      <div class="toolbar">
        <button data-testid="open" onClick={open}>Open</button>
        <button data-testid="save" onClick={save}>Save</button>
        <span class="path" data-testid="path">{path() ?? 'untitled'}</span>
      </div>
      <div class="editor" ref={host} />
      <div class="statusbar">
        <span data-testid="pos">Ln {pos().line}, Col {pos().col}</span>
        <span data-testid="status">{status()}</span>
      </div>
    </div>
  )
}
