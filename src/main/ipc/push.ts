import { BrowserWindow } from 'electron'
import type { PushChannel, PushPayload } from '@shared/ipc'

export const pushToAll = <C extends PushChannel>(channel: C, payload: PushPayload<C>): void => {
  BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(channel, payload))
}
