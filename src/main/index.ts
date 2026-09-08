import { existsSync, statSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { A, pipe } from '@mobily/ts-belt'
import { channels } from '@shared/channels'
import { createConfigService } from './config/service'
import { registerHandlers } from './ipc/handlers'
import { pushToAll } from './ipc/push'
import { initLogging, installCrashHooks, logger, registerLogChannel } from './log'
import { markDidFinishLoad, markFirstPaint, markReady, metrics } from './perf'
import { probePty } from './pty/probe'
import { createDirtyStore } from './session/dirtyStore'
import { createWindow } from './window'

const isTest = process.env['MORU_TEST'] === '1'
const hidden = process.env['MORU_HIDDEN'] === '1'

const userDataOverride = process.env['MORU_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)

const isExistingFile = (path: string): boolean => existsSync(path) && statSync(path).isFile()

const startupPaths = (): readonly string[] => {
  const fromEnv = (process.env['MORU_TEST_OPEN'] ?? '').split(delimiter).filter((p) => p.length > 0)
  const fromArgv = pipe(
    process.argv.slice(is.dev ? 2 : 1),
    A.filter((arg) => !arg.startsWith('-')),
    A.map((arg) => resolve(arg)),
    A.filter(isExistingFile),
  )
  return [...fromEnv, ...fromArgv]
}

const exposeTestGlobals = (): void => {
  globalThis.__moruMetrics = metrics
  globalThis.__moruProbePty = probePty
}

app.whenReady().then(async () => {
  markReady()
  if (hidden) app.dock?.hide()

  const userData = app.getPath('userData')
  const config = await createConfigService(userData, (snapshot) => pushToAll('config.changed', snapshot))
  initLogging(userData, config.snapshot().settings.log.level)
  logger.info('app ready', { version: app.getVersion(), electron: process.versions.electron })

  electronApp.setAppUserModelId('kr.moru.app')
  app.on('browser-window-created', (_event, window) => optimizer.watchWindowShortcuts(window))

  const dirty = createDirtyStore(userData)
  registerHandlers({ config, dirty, startupPaths: startupPaths() })
  registerLogChannel()
  ipcMain.on(channels.perfFirstPaint, markFirstPaint)
  if (isTest) exposeTestGlobals()

  const window = createWindow()
  window.webContents.on('did-finish-load', markDidFinishLoad)
  installCrashHooks(() => window.webContents.reload())

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
