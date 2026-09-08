import { For, Show, createMemo, onMount } from 'solid-js'
import type { SearchMatch } from '@shared/search'
import type { Workspace } from '../../app/workspace'
import { type FileResult, type SearchState, isIncluded, matchKey, ordinalIn, previewOf } from '../../search/state'

type Props = { readonly ws: Workspace; readonly searchId: string }

const MAX_ROWS = 2000
const CONTEXT = 120

const clip = (m: SearchMatch): { head: string; hit: string; tail: string } => {
  const start = Math.max(0, m.from - CONTEXT)
  const end = Math.min(m.text.length, m.to + CONTEXT)
  return {
    head: (start > 0 ? '…' : '') + m.text.slice(start, m.from),
    hit: m.text.slice(m.from, m.to),
    tail: m.text.slice(m.to, end) + (end < m.text.length ? '…' : ''),
  }
}

const statusText = (s: SearchState): string => {
  if (s.status === 'idle') return ''
  if (s.status === 'running') return 'running…'
  if (s.status === 'error') return `error: ${s.error ?? 'unknown'}`
  const count = s.truncated ? '10000+' : String(s.total)
  const files = s.files.length
  return `${count} match${s.total === 1 && !s.truncated ? '' : 'es'} in ${files} file${files === 1 ? '' : 's'}${s.truncated ? ' (truncated)' : ''}`
}

export const SearchHost = (props: Props) => {
  let patternInput: HTMLInputElement | undefined
  let host!: HTMLDivElement

  const s = (): SearchState | undefined => props.ws.state.searches[props.searchId]
  const run = (): void => void props.ws.runSearch(props.searchId)
  const relOf = (path: string): string => props.ws.relativePath(path)

  const onFormKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      props.ws.activeView()?.focus()
    }
  }

  const rows = createMemo(() => {
    const current = s()
    if (!current) return { files: [] as FileResult[], hidden: 0 }
    let budget = MAX_ROWS
    const files: FileResult[] = []
    for (const f of current.files) {
      if (budget <= 0) break
      const matches = f.matches.slice(0, budget)
      budget -= matches.length
      files.push({ ...f, matches })
    }
    return { files, hidden: Math.max(0, current.total - (MAX_ROWS - budget)) }
  })

  onMount(() => {
    host.addEventListener('focusin', () => props.ws.setSearchFocus(true))
    host.addEventListener('focusout', (e) => {
      if (!host.contains(e.relatedTarget as Node | null)) props.ws.setSearchFocus(false)
    })
    queueMicrotask(() => patternInput?.focus())
  })

  const toggle = (key: 'regexp' | 'caseSensitive' | 'wholeWord', label: string, title: string) => (
    <button
      class="search-toggle"
      classList={{ on: s()?.spec[key] ?? false }}
      data-testid={`search-toggle-${key === 'regexp' ? 'regex' : key === 'caseSensitive' ? 'case' : 'word'}`}
      title={title}
      onClick={() => props.ws.setSearchSpec(props.searchId, { [key]: !(s()?.spec[key] ?? false) })}
    >
      {label}
    </button>
  )

  return (
    <div class="search-tab" data-testid="search-tab" ref={host}>
      <Show when={s()}>
        {(search) => (
          <>
            <div class="search-form">
              <div class="search-row">
                <input
                  ref={patternInput}
                  class="search-input"
                  data-testid="search-pattern"
                  placeholder="Find"
                  spellcheck={false}
                  value={search().spec.pattern}
                  onInput={(e) => props.ws.setSearchSpec(props.searchId, { pattern: e.currentTarget.value })}
                  onKeyDown={onFormKey}
                />
                {toggle('regexp', '.*', 'Regular expression')}
                {toggle('caseSensitive', 'Aa', 'Case sensitive')}
                {toggle('wholeWord', '“”', 'Whole word')}
                <button class="search-run" data-testid="search-run" onClick={run}>
                  Find
                </button>
              </div>
              <div class="search-row">
                <input
                  class="search-input"
                  data-testid="search-replace"
                  placeholder="Replace"
                  spellcheck={false}
                  value={search().replacement}
                  onInput={(e) => props.ws.setSearchReplacement(props.searchId, e.currentTarget.value)}
                  onKeyDown={onFormKey}
                />
                <button
                  class="search-toggle"
                  classList={{ on: search().preserveCase }}
                  data-testid="search-toggle-preserve"
                  title="Preserve case"
                  onClick={() => props.ws.setSearchReplacement(props.searchId, search().replacement, !search().preserveCase)}
                >
                  AB
                </button>
                <button
                  class="search-run"
                  data-testid="search-replace-all"
                  disabled={search().status !== 'done' || search().replacement === '' || search().total === 0}
                  onClick={() => void props.ws.searchReplaceAll(props.searchId)}
                >
                  Replace All
                </button>
                <button class="search-run" data-testid="search-undo" onClick={() => void props.ws.searchUndoReplace()}>
                  Undo Replace in Files
                </button>
              </div>
              <div class="search-row">
                <input
                  class="search-input"
                  data-testid="search-include"
                  placeholder="Include: *.ts, src/**"
                  spellcheck={false}
                  value={search().spec.include}
                  onInput={(e) => props.ws.setSearchSpec(props.searchId, { include: e.currentTarget.value })}
                  onKeyDown={onFormKey}
                />
                <input
                  class="search-input"
                  data-testid="search-exclude"
                  placeholder="Exclude"
                  spellcheck={false}
                  value={search().spec.exclude}
                  onInput={(e) => props.ws.setSearchSpec(props.searchId, { exclude: e.currentTarget.value })}
                  onKeyDown={onFormKey}
                />
                <span class="search-status" data-testid="search-status">
                  {statusText(search())}
                </span>
              </div>
            </div>
            <div class="search-results">
              <For each={rows().files}>
                {(file) => (
                  <div class="search-file">
                    <div class="search-file-row" data-testid="search-file" classList={{ excluded: search().excluded[file.path] === true }}>
                      <input
                        type="checkbox"
                        data-testid="search-file-toggle"
                        checked={!search().excluded[file.path]}
                        onChange={() => props.ws.toggleSearchExcluded(props.searchId, file.path)}
                      />
                      <span class="search-chevron" onClick={() => props.ws.toggleSearchCollapsed(props.searchId, file.path)}>
                        {search().collapsed[file.path] ? '▸' : '▾'}
                      </span>
                      <span class="search-file-path" onClick={() => props.ws.toggleSearchCollapsed(props.searchId, file.path)}>
                        {relOf(file.path)}
                      </span>
                      <span class="search-file-count">
                        {file.matches.length}
                        {file.source === 'buffer' ? ' •' : ''}
                      </span>
                    </div>
                    <Show when={!search().collapsed[file.path]}>
                      <For each={file.matches}>
                        {(m) => {
                          const index = () => ordinalIn(file, m)
                          const included = () => isIncluded(search(), m, index())
                          const parts = () => clip(m)
                          return (
                            <div
                              class="search-match"
                              data-testid="search-match"
                              classList={{ excluded: !included() }}
                              onClick={() => void props.ws.openMatch(m, true)}
                              onDblClick={() => void props.ws.openMatch(m, false)}
                            >
                              <input
                                type="checkbox"
                                data-testid="search-match-toggle"
                                checked={included()}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => props.ws.toggleSearchExcluded(props.searchId, matchKey(m, index()))}
                              />
                              <span class="search-line">{m.line}</span>
                              <span class="search-text">
                                {parts().head}
                                <Show when={previewOf(search(), m)} fallback={<mark>{parts().hit}</mark>}>
                                  {(p) => (
                                    <>
                                      <del>{parts().hit}</del>
                                      <ins>{p()}</ins>
                                    </>
                                  )}
                                </Show>
                                {parts().tail}
                              </span>
                            </div>
                          )
                        }}
                      </For>
                    </Show>
                  </div>
                )}
              </For>
              <Show when={rows().hidden > 0}>
                <div class="search-more">… {rows().hidden} more</div>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}
