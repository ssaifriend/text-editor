import type { BrowserWindow, WebContents } from 'electron'
import { D } from '@mobily/ts-belt'
import type { PushChannel, PushPayload } from '@shared/ipc'
import type { WindowSnapshot } from '@shared/session'

export type WindowInfo = {
  readonly windowId: string
  readonly window: BrowserWindow
  readonly startupPaths: readonly string[]
  readonly projectRoot: string | null
  readonly session: WindowSnapshot | null
}

export type WindowRegistry = {
  readonly add: (info: Omit<WindowInfo, 'windowId'>) => WindowInfo
  readonly remove: (windowId: string) => void
  readonly bySender: (sender: WebContents) => WindowInfo | null
  readonly all: () => readonly WindowInfo[]
  readonly setRoot: (sender: WebContents, root: string | null) => void
  readonly focusedRoot: () => string | null
}

export const createWindowRegistry = (): WindowRegistry => {
  let windows: Record<string, WindowInfo> = {}
  let counter = 0

  return {
    add: (info) => {
      const windowId = `w${(counter += 1)}`
      const full = { ...info, windowId }
      windows = D.set(windows, windowId, full)
      return full
    },
    remove: (windowId) => {
      windows = D.deleteKey(windows, windowId)
    },
    bySender: (sender) => Object.values(windows).find((w) => w.window.webContents === sender) ?? null,
    all: () => Object.values(windows),
    setRoot: (sender, root) => {
      const info = Object.values(windows).find((w) => w.window.webContents === sender)
      if (info) windows = D.set(windows, info.windowId, { ...info, projectRoot: root })
    },
    focusedRoot: () => {
      const all = Object.values(windows)
      const focused = all.find((w) => !w.window.isDestroyed() && w.window.isFocused())
      return (focused ?? all[0])?.projectRoot ?? null
    },
  }
}

export const pushTo = <C extends PushChannel>(target: WebContents, channel: C, payload: PushPayload<C>): void => {
  if (!target.isDestroyed()) target.send(channel, payload)
}
