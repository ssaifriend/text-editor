import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { channelList, pushChannels, sendChannels } from '../shared/channels'

const allowed = (list: readonly string[], channel: string): boolean => list.includes(channel)

const api = {
  invoke: (channel: string, payload: unknown): Promise<unknown> =>
    allowed(channelList, channel) && !allowed(sendChannels, channel)
      ? ipcRenderer.invoke(channel, payload)
      : Promise.reject(new Error(`ipc channel not allowed: ${channel}`)),

  send: (channel: string, payload: unknown): void => {
    if (allowed(sendChannels, channel)) ipcRenderer.send(channel, payload)
  },

  on: (channel: string, listener: (payload: unknown) => void): (() => void) => {
    if (!allowed(pushChannels, channel)) return () => undefined

    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },

  memory: (): Promise<{ privateMb: number; sharedMb: number }> =>
    process.getProcessMemoryInfo().then((m) => ({ privateMb: Math.round(m.private / 1024), sharedMb: Math.round(m.shared / 1024) })),
}

contextBridge.exposeInMainWorld('moru', api)

export type MoruApi = typeof api
