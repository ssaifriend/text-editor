import { app, BrowserWindow, ipcMain } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { channels } from '@shared/channels'
import { registerHandlers } from './ipc/handlers'
import { markDidFinishLoad, markFirstPaint, markReady, metrics } from './perf'
import { probePty } from './pty/probe'
import { createWindow } from './window'

const isTest = process.env['MORU_TEST'] === '1'

const userDataOverride = process.env['MORU_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)

const exposeTestGlobals = (): void => {
  globalThis.__moruMetrics = metrics
  globalThis.__moruProbePty = probePty
}

app.whenReady().then(() => {
  markReady()
  electronApp.setAppUserModelId('kr.moru.app')
  app.on('browser-window-created', (_event, window) => optimizer.watchWindowShortcuts(window))

  registerHandlers()
  ipcMain.on(channels.perfFirstPaint, markFirstPaint)
  if (isTest) exposeTestGlobals()

  const window = createWindow()
  window.webContents.on('did-finish-load', markDidFinishLoad)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

declare global {
  // eslint-disable-next-line no-var
  var __moruMetrics: typeof metrics | undefined
  // eslint-disable-next-line no-var
  var __moruProbePty: typeof probePty | undefined
}
