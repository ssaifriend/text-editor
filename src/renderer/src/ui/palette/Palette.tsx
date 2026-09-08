import { R } from '@mobily/ts-belt'
import { Fzf } from 'fzf'
import { type Accessor, For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'
import type { IndexItem } from '@shared/ipc'
import type { Workspace } from '../../app/workspace'
import type { Command, CommandRegistry } from '../../commands/registry'
import { basenameOf } from '../../editor/lang'
import { type GotoQuery, parseGotoQuery } from '../../goto/parse'
import { symbolsOf, wordsOf } from '../../goto/symbols'
import { invoke, on as onPush } from '../../ipc'
import type { CompiledBinding } from '../../keymap/bindings'
import { type Platform, formatKeys } from '../../keymap/keys'

import type { PaletteMode } from './mode'

export type { PaletteMode } from './mode'

export type PaletteProps = {
  readonly open: Accessor<PaletteMode | null>
  readonly initialText: Accessor<string>
  readonly onClose: () => void
  readonly registry: CommandRegistry
  readonly bindings: Accessor<readonly CompiledBinding[]>
  readonly platform: Platform
  readonly ws: Workspace
}

type Item =
  | { kind: 'command'; label: string; detail: string; command: Command }
  | { kind: 'file'; label: string; detail: string; path: string; positions: number[] }
  | { kind: 'recent'; label: string; detail: string; path: string }
  | { kind: 'symbol'; label: string; detail: string; from: number }
  | { kind: 'word'; label: string; detail: string; from: number }
  | { kind: 'line'; label: string; detail: string; line: number; col: number | null }
  | { kind: 'hint'; label: string; detail: string }

const clamp = (n: number, max: number): number => Math.max(0, Math.min(n, max))

const hasSuffix = (q: GotoQuery): boolean => q.symbol !== null || q.line !== null || q.col !== null

const Highlighted = (props: { label: string; positions: readonly number[] }): JSX.Element => {
  const set: Record<number, true> = Object.fromEntries(props.positions.map((p) => [p, true]))
  return <>{Array.from(props.label).map((ch, i) => (set[i] ? <mark>{ch}</mark> : ch))}</>
}

const fuzzy = (all: Item[], text: string, limit: number): Item[] =>
  text === '' ? all.slice(0, limit) : new Fzf(all, { selector: (i) => i.label }).find(text).slice(0, limit).map((m) => m.item)

export const Palette = (props: PaletteProps) => {
  const [query, setQuery] = createSignal('')
  const [index, setIndex] = createSignal(0)
  const [commandItems, setCommandItems] = createSignal<readonly Item[]>([])
  const [fileItems, setFileItems] = createSignal<readonly Item[]>([])
  const [previewTick, setPreviewTick] = createSignal(0)
  let input: HTMLInputElement | undefined
  let fileTimer: ReturnType<typeof setTimeout> | null = null
  let previewTimer: ReturnType<typeof setTimeout> | null = null
  let originalSelection: { anchor: number; head: number } | null = null
  let filesPending: Promise<void> = Promise.resolve()
  let previewPending: Promise<void> = Promise.resolve()

  const keyLabel = (commandId: string): string => {
    const binding = [...props.bindings()].reverse().find((b) => b.command === commandId)
    return binding ? formatKeys(binding.chord, props.platform) : ''
  }

  const relOf = (path: string): string => {
    const root = props.ws.state.projectRoot
    return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : basenameOf(path)
  }

  const parsed = createMemo((): GotoQuery => parseGotoQuery(query()))

  const recentItems = (): Item[] =>
    props.ws.state.mru.slice(0, 20).map((path) => ({ kind: 'recent', label: relOf(path), detail: '⟲ recent', path }))

  const fetchFiles = async (text: string): Promise<void> => {
    if (!props.ws.state.projectRoot) {
      setFileItems([{ kind: 'hint', label: 'No folder open', detail: 'File › Open Folder…' }])
      return
    }
    const result = await invoke('index.query', { text, limit: 50 })
    setFileItems(
      R.getWithDefault(result, { items: [] as IndexItem[] }).items.map((it) => ({
        kind: 'file',
        label: it.rel,
        detail: '',
        path: it.path,
        positions: it.positions,
      })),
    )
  }

  const queryFiles = (text: string): void => {
    if (fileTimer) clearTimeout(fileTimer)
    filesPending = new Promise((resolve) => {
      fileTimer = setTimeout(() => void fetchFiles(text).finally(resolve), 30)
    })
  }

  const settled = async (): Promise<void> => {
    let files: Promise<void>
    let preview: Promise<void>
    do {
      files = filesPending
      preview = previewPending
      await Promise.all([files, preview])
    } while (files !== filesPending || preview !== previewPending)
  }

  onCleanup(
    onPush('index.changed', () => {
      if (props.open() === 'goto' && parsed().mode === 'files') queryFiles(parsed().file)
    }),
  )

  createEffect(
    on(props.open, (mode) => {
      if (fileTimer) clearTimeout(fileTimer)
      if (!mode) return
      const text = props.initialText()
      setQuery(text)
      setIndex(0)
      originalSelection = null
      const view = props.ws.activeView()
      if (view) originalSelection = { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head }

      if (mode === 'commands') {
        setCommandItems(
          [...props.registry.available()]
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((command) => ({ kind: 'command', label: command.title, detail: keyLabel(command.id), command })),
        )
      } else {
        setFileItems([])
        queryFiles(parseGotoQuery(text).file)
      }

      queueMicrotask(() => {
        input?.focus()
        input?.setSelectionRange(text.length, text.length)
      })
    }),
  )

  createEffect(
    on(query, (text) => {
      if (props.open() !== 'goto') return
      setIndex(0)
      const q = parseGotoQuery(text)
      if (q.mode === 'files') queryFiles(q.file)
    }),
  )

  const commandFzf = createMemo(() => new Fzf(commandItems() as Item[], { selector: (item) => item.label }))

  const symbolItems = (text: string): Item[] => {
    const view = props.ws.activeView()
    const buffer = props.ws.activeBuffer()
    if (!view || !buffer) return []
    const all = symbolsOf(view.state, buffer.languageId).map((s): Item => ({ kind: 'symbol', label: s.name, detail: s.kind, from: s.from }))
    return fuzzy(all, text, 200)
  }

  const wordItems = (text: string): Item[] => {
    const view = props.ws.activeView()
    if (!view) return []
    const all = wordsOf(view.state).map((w): Item => ({ kind: 'word', label: w.word, detail: '', from: w.from }))
    return fuzzy(all, text, 200)
  }

  const lineItems = (q: GotoQuery): Item[] =>
    q.line !== null
      ? [{ kind: 'line', label: `Go to line ${q.line}${q.col !== null ? `, column ${q.col}` : ''}`, detail: '', line: q.line, col: q.col }]
      : [{ kind: 'hint', label: 'Type a line number', detail: ':line[:col]' }]

  const gotoItems = createMemo((): Item[] => {
    const q = parsed()
    previewTick()
    if (q.mode === 'lines') return lineItems(q)
    if (q.mode === 'symbols') return symbolItems(q.symbol ?? '')
    if (q.mode === 'words') return wordItems(q.word ?? '')
    if (hasSuffix(q)) return q.symbol !== null ? symbolItems(q.symbol) : lineItems(q)
    if (q.file.trim() === '') return [...recentItems(), ...fileItems().filter((f) => f.kind === 'hint')]
    return [...fileItems()]
  })

  const items = createMemo((): Item[] => {
    if (props.open() === 'commands') return query().trim() === '' ? [...commandItems()] : commandFzf().find(query()).map((m) => m.item)
    return gotoItems()
  })

  const topFile = createMemo((): string | null => {
    const q = parsed()
    if (props.open() !== 'goto' || q.mode !== 'files' || !hasSuffix(q) || q.file.trim() === '') return null
    const first = fileItems()[0]
    return first?.kind === 'file' ? first.path : null
  })

  createEffect(
    on(topFile, (path) => {
      if (!path) return
      previewPending = props.ws.previewFile(path).then(() => {
        setPreviewTick((n) => n + 1)
      })
    }),
  )

  const schedulePreview = (item: Item | undefined): void => {
    if (previewTimer) clearTimeout(previewTimer)
    if (!item) return
    previewTimer = setTimeout(() => {
      if (item.kind === 'file' || item.kind === 'recent') void props.ws.previewFile(item.path)
      if (item.kind === 'symbol' || item.kind === 'word') props.ws.jumpTo(item.from)
    }, 80)
  }

  createEffect(
    on([items, index], ([list, i]) => {
      if (props.open() === 'goto') schedulePreview(list[i])
    }),
  )

  const close = (): void => {
    if (previewTimer) clearTimeout(previewTimer)
    props.onClose()
  }

  const cancel = (): void => {
    if (previewTimer) clearTimeout(previewTimer)
    props.ws.cancelPreview()
    const view = props.ws.activeView()
    if (view && originalSelection) view.dispatch({ selection: originalSelection })
    close()
  }

  const run = async (item: Item | undefined): Promise<void> => {
    if (previewTimer) clearTimeout(previewTimer)
    if (!item || item.kind === 'hint') return close()

    if (item.kind === 'command') {
      close()
      setTimeout(() => void props.registry.run(item.command.id), 0)
      return
    }

    if (item.kind === 'file' || item.kind === 'recent') await props.ws.previewFile(item.path)
    props.ws.commitPreview()
    if (item.kind === 'symbol' || item.kind === 'word') props.ws.jumpTo(item.from)
    if (item.kind === 'line') props.ws.gotoLine(item.line, item.col)
    close()
  }

  const submit = async (): Promise<void> => {
    if (props.open() === 'goto' && parsed().mode === 'files') await settled()
    await run(items()[index()])
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => clamp(i + 1, items().length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => clamp(i - 1, items().length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (props.open() === 'goto') cancel()
      else close()
    }
  }

  const dismiss = (): void => (props.open() === 'goto' ? cancel() : close())

  return (
    <Show when={props.open()}>
      <div class="palette-backdrop" onMouseDown={dismiss}>
        <div class="palette" data-testid="palette" data-mode={props.open() ?? ''} onMouseDown={(e) => e.stopPropagation()}>
          <input
            ref={input}
            data-testid="palette-input"
            class="palette-input"
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value)
              setIndex(0)
            }}
            onKeyDown={onKeyDown}
            placeholder={props.open() === 'goto' ? 'Go to file  ·  @symbol  ·  :line  ·  #word' : 'Command'}
            spellcheck={false}
            autocomplete="off"
          />
          <div class="palette-list" role="listbox">
            <For each={items().slice(0, 40)}>
              {(item, i) => (
                <div
                  class="palette-item"
                  data-testid="palette-item"
                  role="option"
                  classList={{ selected: i() === index(), hint: item.kind === 'hint' }}
                  onMouseEnter={() => setIndex(i())}
                  onMouseDown={() => {
                    void run(item)
                  }}
                >
                  <span class="palette-title">{item.kind === 'file' ? <Highlighted label={item.label} positions={item.positions} /> : item.label}</span>
                  <span class="palette-keys">{item.detail}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  )
}
