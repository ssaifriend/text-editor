import { contextBridge } from 'electron'

const api = {}

contextBridge.exposeInMainWorld('moru', api)

export type MoruApi = typeof api
