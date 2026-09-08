import { createSignal, onMount } from 'solid-js'
import { R } from '@mobily/ts-belt'
import { channels } from '@shared/channels'
import { encodingLabel, eolLabel } from '@shared/encoding'
import type { OpenedFile, SaveError } from '@shared/ipc'
import { createEditor, type Editor } from './editor/createEditor'
import { cursorPosition, type CursorPosition } from './editor/cursor'
import { languageFor } from './editor/lang'
import { invoke } from './ipc'
import { installTestHooks } from './testHooks'

export type FileMeta = Omit<OpenedFile, 'text'>

type SaveMode = 'normal' | 'overwrite'

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

export const App = () => {
  const [meta, setMeta] = createSignal<FileMeta | null>(null)
  const [pos, setPos] = createSignal<CursorPosition>({ line: 1, col: 1 })
  const [status, setStatus] = createSignal('')

  let host!: HTMLDivElement
  let editor!: Editor

  const openPath = async (target: string): Promise<void> => {
    const result = await invoke('fs.open', { path: target })

    R.match(
      result,
      ({ text, ...rest }) => {
        editor.setDoc(text, languageFor(rest.path))
        setMeta(rest)
        setStatus(`opened ${rest.path}`)
      },
      (error) => setStatus(`open failed: ${error.message}`),
    )
  }

  const open = async (): Promise<void> => {
    const picked = await invoke('dialog.openFile', undefined)
    R.tap(picked, ({ path }) => {
      if (path) void openPath(path)
    })
  }

  const pickSavePath = async (): Promise<string | null> => {
    const picked = await invoke('dialog.saveFile', meta()?.path ?? null)
    return R.match(picked, (d) => d.path, () => null)
  }

  const save = async (mode: SaveMode = 'normal'): Promise<void> => {
    const current = meta()
    const target = current?.path ?? (await pickSavePath())
    if (!target) return

    const encoding = current?.encoding ?? 'utf8'
    const bom = current?.bom ?? false
    const eol = current?.eol ?? 'lf'

    const result = await invoke('fs.save', {
      path: target,
      text: editor.view.state.doc.toString(),
      encoding,
      bom,
      eol,
      expectedHash: current?.path === target ? current.hash : null,
      mode,
    })

    R.match(
      result,
      (saved) => {
        setMeta({
          path: saved.path,
          encoding,
          bom,
          eol,
          mixedEol: false,
          confidence: 'high',
          hash: saved.hash,
          mtimeMs: saved.mtimeMs,
          readonly: false,
          largeFile: current?.largeFile ?? false,
        })
        setStatus(`saved ${saved.bytes} bytes`)
      },
      (error) => setStatus(describeSaveError(error)),
    )
  }

  onMount(async () => {
    editor = createEditor(host, (state) => setPos(cursorPosition(state)))
    requestAnimationFrame(() => window.moru.send(channels.perfFirstPaint, undefined))

    const bootstrap = await invoke('app.bootstrap', undefined)
    R.tap(bootstrap, ({ paths, test }) => {
      if (test) installTestHooks(editor, { path: () => meta()?.path ?? null, meta, save })
      const last = paths.at(-1)
      if (last) void openPath(last)
    })
  })

  const encodingText = (): string => {
    const current = meta()
    return current ? encodingLabel(current.encoding, current.bom) : ''
  }

  const eolText = (): string => {
    const current = meta()
    return current ? eolLabel(current.eol) : ''
  }

  return (
    <div class="app">
      <div class="toolbar">
        <button data-testid="open" onClick={open}>Open</button>
        <button data-testid="save" onClick={() => save()}>Save</button>
        <span class="path" data-testid="path">{meta()?.path ?? 'untitled'}</span>
      </div>
      <div class="editor" ref={host} />
      <div class="statusbar">
        <span data-testid="pos">Ln {pos().line}, Col {pos().col}</span>
        <span data-testid="encoding">{encodingText()}</span>
        <span data-testid="eol">{eolText()}</span>
        <span data-testid="status">{status()}</span>
      </div>
    </div>
  )
}
