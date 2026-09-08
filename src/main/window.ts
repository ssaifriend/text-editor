import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'

const hidden = process.env['MORU_HIDDEN'] === '1'

export type WindowBounds = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export const createWindow = (bounds: WindowBounds | null = null): BrowserWindow => {
  const window = new BrowserWindow({
    ...(bounds ?? { width: 1200, height: 800 }),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: process.env['MORU_HIDDEN'] !== '1',
    },
  })

  window.on('ready-to-show', () => {
    if (!hidden) window.show()
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    window.loadURL(devUrl)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
