import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createWindow } from './window'

const userDataOverride = process.env['MORU_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)

app.whenReady().then(() => {
  electronApp.setAppUserModelId('kr.moru.app')
  app.on('browser-window-created', (_event, window) => optimizer.watchWindowShortcuts(window))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
