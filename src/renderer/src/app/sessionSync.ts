import { createEffect, onCleanup } from 'solid-js'
import type { WindowSnapshot } from '@shared/session'
import type { Workspace } from './workspace'

type Deps = { readonly send: (snapshot: WindowSnapshot) => void; readonly debounceMs?: number; readonly tickMs?: number }

export const installSessionSync = (ws: Workspace, { send, debounceMs = 500, tickMs = 5000 }: Deps): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    send(ws.snapshot())
  }

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, debounceMs)
  }

  createEffect(() => {
    ws.tree()
    ws.state.activePane
    ws.state.projectRoot
    ws.state.sidebar.open
    Object.keys(ws.state.sidebar.expanded)
    Object.values(ws.state.tabs).length
    Object.values(ws.state.buffers).forEach((b) => {
      b.dirty
      b.path
    })
    Object.values(ws.state.terminals).length
    schedule()
  })

  const tick = setInterval(schedule, tickMs)
  const onUnload = (): void => flush()
  window.addEventListener('beforeunload', onUnload)

  onCleanup(() => {
    if (timer) clearTimeout(timer)
    clearInterval(tick)
    window.removeEventListener('beforeunload', onUnload)
  })

  return flush
}
