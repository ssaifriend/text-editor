import { Show } from 'solid-js'
import type { Banner as BannerState, Workspace } from '../../app/workspace'
import type { PaneLeaf } from '../layout/paneTree'

type Props = { readonly ws: Workspace; readonly leaf: () => PaneLeaf }

const describe = (banner: BannerState): string => {
  switch (banner.kind) {
    case 'conflict':
      return 'File changed on disk since it was opened.'
    case 'encodingLossy':
      return `Encoding cannot represent ${banner.positions.length} character(s).`
    case 'readonly':
      return 'File is read-only.'
    case 'external':
      return 'File changed on disk while you have unsaved edits.'
    case 'deleted':
      return 'File was deleted on disk.'
  }
}

export const Banner = (props: Props) => {
  const bufferId = (): string | null => {
    const active = props.leaf().active
    const tab = active ? props.ws.state.tabs[active] : undefined
    return tab?.kind === 'buffer' ? tab.bufferId : null
  }

  const banner = (): BannerState | undefined => {
    const id = bufferId()
    return id ? props.ws.state.banners[id] : undefined
  }

  const act = (f: () => void | Promise<void>) => (): void => {
    props.ws.focusPane(props.leaf().id)
    void f()
  }

  return (
    <Show when={banner()}>
      {(b) => (
        <div class="banner" data-testid="banner">
          <span class="banner-text">{describe(b())}</span>
          <Show when={b().kind === 'conflict'}>
            <button data-testid="banner-action" onClick={act(() => props.ws.save('overwrite'))}>
              Overwrite
            </button>
            <button data-testid="banner-action" onClick={act(() => props.ws.reload())}>
              Reload from Disk
            </button>
          </Show>
          <Show when={b().kind === 'encodingLossy'}>
            <button data-testid="banner-action" onClick={act(() => props.ws.saveAsUtf8())}>
              Save as UTF-8
            </button>
          </Show>
          <Show when={b().kind === 'readonly'}>
            <button data-testid="banner-action" onClick={act(() => props.ws.saveAs())}>
              Save As…
            </button>
          </Show>
          <Show when={b().kind === 'external'}>
            <button data-testid="banner-action" onClick={act(() => props.ws.compareWithDisk())}>
              Compare
            </button>
            <button data-testid="banner-action" onClick={act(() => props.ws.reload())}>
              Load Disk Version
            </button>
            <button data-testid="banner-action" onClick={act(() => props.ws.keepMine())}>
              Keep Mine
            </button>
          </Show>
          <Show when={b().kind === 'deleted'}>
            <button data-testid="banner-action" onClick={act(() => props.ws.recreateDeleted())}>
              Save
            </button>
          </Show>
          <button
            data-testid="banner-action"
            onClick={act(() => {
              const id = bufferId()
              if (id) props.ws.dismissBanner(id)
            })}
          >
            Dismiss
          </button>
        </div>
      )}
    </Show>
  )
}
