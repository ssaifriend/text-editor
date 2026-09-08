import { Show, createEffect, on } from 'solid-js'
import type { Workspace } from '../../app/workspace'
import type { FindSpec } from '../../find/state'

type Props = { readonly ws: Workspace }

type ToggleKey = 'regexp' | 'caseSensitive' | 'wholeWord' | 'inSelection' | 'wrap' | 'preserveCase'

const toggles: readonly { key: ToggleKey; label: string; title: string; testId: string }[] = [
  { key: 'regexp', label: '.*', title: 'Regular expression', testId: 'find-toggle-regexp' },
  { key: 'caseSensitive', label: 'Aa', title: 'Case sensitive', testId: 'find-toggle-case' },
  { key: 'wholeWord', label: '\\b', title: 'Whole word', testId: 'find-toggle-word' },
  { key: 'inSelection', label: '⧉', title: 'In selection', testId: 'find-toggle-selection' },
  { key: 'wrap', label: '↻', title: 'Wrap around', testId: 'find-toggle-wrap' },
  { key: 'preserveCase', label: 'AB→ab', title: 'Preserve case', testId: 'find-toggle-preserve' },
]

export const FindPanel = (props: Props) => {
  let findInput: HTMLInputElement | undefined

  const find = () => props.ws.state.find

  createEffect(
    on(
      () => find().open,
      (open) => {
        if (open) queueMicrotask(() => findInput?.select())
      },
    ),
  )

  const countText = (): string => {
    const { count, capped, current } = find()
    const total = capped ? `${count}+` : `${count}`
    return current !== null && !capped ? `${current} / ${total}` : total
  }

  const onFindKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && e.altKey) {
      e.preventDefault()
      props.ws.findSelectAll()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) props.ws.findPrevious()
      else props.ws.findNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      props.ws.closeFind()
    }
  }

  const onReplaceKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.altKey) props.ws.replaceAll()
      else props.ws.replaceNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      props.ws.closeFind()
    }
  }

  const set = (patch: Partial<FindSpec>): void => props.ws.setFindSpec(patch)

  return (
    <Show when={find().open}>
      <div
        class="find-panel"
        data-testid="find-panel"
        onFocusIn={() => props.ws.setFindFocus(true)}
        onFocusOut={() => props.ws.setFindFocus(false)}
      >
        <div class="find-row">
          <input
            ref={findInput}
            data-testid="find-input"
            classList={{ invalid: !find().valid && find().spec.search.length > 0 }}
            value={find().spec.search}
            placeholder="Find"
            spellcheck={false}
            onInput={(e) => set({ search: e.currentTarget.value })}
            onKeyDown={onFindKey}
          />
          {toggles.map((t) => (
            <button
              class="find-toggle"
              data-testid={t.testId}
              title={t.title}
              classList={{ on: find().spec[t.key] }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => set({ [t.key]: !find().spec[t.key] } as Partial<FindSpec>)}
            >
              {t.label}
            </button>
          ))}
          <span class="find-count" data-testid="find-count">{countText()}</span>
          <button class="find-toggle" data-testid="find-prev" title="Previous" onMouseDown={(e) => e.preventDefault()} onClick={() => props.ws.findPrevious()}>↑</button>
          <button class="find-toggle" data-testid="find-next" title="Next" onMouseDown={(e) => e.preventDefault()} onClick={() => props.ws.findNext()}>↓</button>
          <button class="find-toggle" data-testid="find-select-all" title="Select all" onMouseDown={(e) => e.preventDefault()} onClick={() => props.ws.findSelectAll()}>All</button>
          <button class="find-toggle" data-testid="find-close" title="Close" onMouseDown={(e) => e.preventDefault()} onClick={() => props.ws.closeFind()}>×</button>
        </div>
        <Show when={find().replaceOpen}>
          <div class="find-row">
            <input
              data-testid="replace-input"
              value={find().spec.replace}
              placeholder="Replace"
              spellcheck={false}
              onInput={(e) => set({ replace: e.currentTarget.value })}
              onKeyDown={onReplaceKey}
            />
            <button class="find-toggle" data-testid="find-replace" onMouseDown={(e) => e.preventDefault()} onClick={() => props.ws.replaceNext()}>Replace</button>
            <button class="find-toggle" data-testid="find-replace-all" onMouseDown={(e) => e.preventDefault()} onClick={() => props.ws.replaceAll()}>Replace All</button>
          </div>
        </Show>
      </div>
    </Show>
  )
}
