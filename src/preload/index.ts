import { contextBridge, ipcRenderer } from 'electron'
import { channelList, sendChannels } from '../shared/channels'

const allowed = (list: readonly string[], channel: string): boolean => list.includes(channel)

const api = {
  invoke: (channel: string, payload: unknown): Promise<unknown> =>
    allowed(channelList, channel)
      ? ipcRenderer.invoke(channel, payload)
      : Promise.reject(new Error(`ipc channel not allowed: ${channel}`)),

  send: (channel: string, payload: unknown): void => {
    if (allowed(sendChannels, channel)) ipcRenderer.send(channel, payload)
  },
}

contextBridge.exposeInMainWorld('moru', api)

export type MoruApi = typeof api
