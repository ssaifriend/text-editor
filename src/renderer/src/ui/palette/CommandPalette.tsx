import { Fzf } from 'fzf'
import { type Accessor, For, Show, createEffect, createMemo, createSignal, on } from 'solid-js'
import type { Command, CommandRegistry } from '../../commands/registry'
import type { CompiledBinding } from '../../keymap/bindings'
import { type Platform, formatKeys } from '../../keymap/keys'

export type PaletteProps = {
  readonly open: Accessor<boolean>
  readonly onClose: () => void
  readonly registry: CommandRegistry
  readonly bindings: readonly CompiledBinding[]
  readonly platform: Platform
}

type Item = { readonly command: Command; readonly keys: string }

const clamp = (n: number, max: number): number => Math.max(0, Math.min(n, max))

export const CommandPalette = (props: PaletteProps) => {
  const [query, setQuery] = createSignal('')
  const [index, setIndex] = createSignal(0)
  const [items, setItems] = createSignal<readonly Item[]>([])
  let input: HTMLInputElement | undefined

  const keyLabel = (commandId: string): string => {
    const binding = props.bindings.find((b) => b.command === commandId)
    return binding ? formatKeys(binding.chord, props.platform) : ''
  }

  createEffect(
    on(props.open, (open) => {
      if (!open) return
      setQuery('')
      setIndex(0)
      setItems(
        [...props.registry.available()]
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((command) => ({ command, keys: keyLabel(command.id) })),
      )
      queueMicrotask(() => input?.focus())
    }),
  )

  const fzf = createMemo(() => new Fzf(items(), { selector: (item) => item.command.title }))

  const matches = createMemo(() => (query().trim() === '' ? items() : fzf().find(query()).map((r) => r.item)))

  const run = (item: Item | undefined): void => {
    props.onClose()
    if (item) setTimeout(() => void props.registry.run(item.command.id), 0)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => clamp(i + 1, matches().length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => clamp(i - 1, matches().length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(matches()[index()])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      props.onClose()
    }
  }

  return (
    <Show when={props.open()}>
      <div class="palette-backdrop" onMouseDown={props.onClose}>
        <div class="palette" data-testid="palette" onMouseDown={(e) => e.stopPropagation()}>
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
            placeholder="Command"
            spellcheck={false}
            autocomplete="off"
          />
          <div class="palette-list" role="listbox">
            <For each={matches().slice(0, 40)}>
              {(item, i) => (
                <div
                  class="palette-item"
                  data-testid="palette-item"
                  role="option"
                  classList={{ selected: i() === index() }}
                  onMouseEnter={() => setIndex(i())}
                  onMouseDown={() => run(item)}
                >
                  <span class="palette-title">{item.command.title}</span>
                  <span class="palette-keys">{item.keys}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  )
}
