import type { BrowserWindow, WebContents } from 'electron'
import { D } from '@mobily/ts-belt'
import type { PushChannel, PushPayload } from '@shared/ipc'

export type WindowInfo = {
  readonly windowId: string
  readonly window: BrowserWindow
  readonly startupPaths: readonly string[]
  readonly projectRoot: string | null
}

export type WindowRegistry = {
  readonly add: (info: Omit<WindowInfo, 'windowId'>) => WindowInfo
  readonly remove: (windowId: string) => void
  readonly bySender: (sender: WebContents) => WindowInfo | null
  readonly all: () => readonly WindowInfo[]
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
  }
}

export const pushTo = <C extends PushChannel>(target: WebContents, channel: C, payload: PushPayload<C>): void => {
  if (!target.isDestroyed()) target.send(channel, payload)
}
