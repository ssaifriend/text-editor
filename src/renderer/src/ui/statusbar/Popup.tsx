import { For, onCleanup, onMount } from 'solid-js'

export type PopupItem = { readonly label: string; readonly active?: boolean; readonly onSelect: () => void }

export const Popup = (props: { items: readonly PopupItem[]; onClose: () => void }) => {
  let root!: HTMLDivElement

  onMount(() => {
    const onDown = (e: MouseEvent): void => {
      if (!root.contains(e.target as Node)) props.onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    onCleanup(() => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    })
  })

  return (
    <div class="popup" ref={root} role="menu">
      <For each={props.items}>
        {(item) => (
          <div
            class="popup-item"
            data-testid="popup-item"
            classList={{ active: item.active ?? false }}
            role="menuitem"
            onClick={() => {
              item.onSelect()
              props.onClose()
            }}
          >
            {item.label}
          </div>
        )}
      </For>
    </div>
  )
}
