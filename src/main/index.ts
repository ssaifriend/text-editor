import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import watcher from '@parcel/watcher'
import { rgPath } from '@vscode/ripgrep'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { A, pipe } from '@mobily/ts-belt'
import { channels } from '@shared/channels'
import type { Bounds, WindowSnapshot } from '@shared/session'
import { createConfigService, createKeymapService } from './config/service'
import { createIndexService } from './index/service'
import { createReplaceService } from './search/replace'
import { createSearchService } from './search/run'
import { registerHandlers } from './ipc/handlers'
import { pushToAll } from './ipc/push'
import { initLogging, installCrashHooks, logger, registerLogChannel } from './log'
import { installMenu } from './menu'
import { markDidFinishLoad, markFirstPaint, markReady, metrics } from './perf'
import { defaultShell, resolveShellEnv } from './pty/env'
import { createPtyManager } from './pty/manager'
import { probePty } from './pty/probe'
import { createDirtyStore } from './session/dirtyStore'
import { createSessionStore } from './session/sessionStore'
import { createExpectedWrites } from './watch/expected'
import { createWatchService } from './watch/service'
import { createWindow } from './window'
import { createWindowRegistry, pushTo } from './windows'

const isTest = process.env['MORU_TEST'] === '1'
const hidden = process.env['MORU_HIDDEN'] === '1'
let quitConfirmed = false

const userDataOverride = process.env['MORU_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)

const isExistingFile = (path: string): boolean => existsSync(path) && statSync(path).isFile()
const isExistingDir = (path: string): boolean => existsSync(path) && statSync(path).isDirectory()

const argvPaths = (): readonly string[] =>
  pipe(
    process.argv.slice(is.dev ? 2 : 1),
    A.filter((arg) => !arg.startsWith('-')),
    A.map((arg) => resolve(arg)),
  )

const startupPaths = (): readonly string[] => {
  const fromEnv = (process.env['MORU_TEST_OPEN'] ?? '').split(delimiter).filter((p) => p.length > 0)
  return [...fromEnv, ...argvPaths().filter(isExistingFile)]
}

const startupRoot = (): string | null => {
  const fromEnv = process.env['MORU_TEST_ROOT']
  if (fromEnv && isExistingDir(fromEnv)) return fromEnv
  return argvPaths().find(isExistingDir) ?? null
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
  const keymap = await createKeymapService(userData, (snapshot) => pushToAll('keymap.changed', snapshot))
  initLogging(userData, config.snapshot().settings.log.level)
  logger.info('app ready', { version: app.getVersion(), electron: process.versions.electron })

  electronApp.setAppUserModelId('kr.moru.app')
  app.on('browser-window-created', (_event, window) => optimizer.watchWindowShortcuts(window))

  const dirty = createDirtyStore(userData)
  const shell = defaultShell(process.platform)
  const env = await resolveShellEnv({ platform: process.platform, shell, spawn: execFile })
  logger.info('shell env resolved', { shell, pathEntries: (env['PATH'] ?? '').split(':').length })
  const ptyManager = createPtyManager({ push: pushTo, env, shell })
  const expected = createExpectedWrites()
  const watch = createWatchService({ subscribe: watcher.subscribe, push: pushToAll, expected })
  app.on('before-quit', () => {
    ptyManager.disposeAll()
    void watch.dispose()
    void index.dispose()
  })
  const windows = createWindowRegistry()
  const sessionStore = createSessionStore(userData)
  const index = createIndexService({ rgPath, subscribe: watcher.subscribe, push: pushToAll })
  const search = createSearchService({ rgPath, push: pushToAll, settings: () => config.snapshot().settings.search })
  const replace = createReplaceService({ expected })
  app.on('before-quit', () => search.dispose())

  let quitting = false
  app.on('before-quit', () => {
    quitting = true
  })

  const openWindow = (
    paths: readonly string[],
    projectRoot: string | null,
    session: WindowSnapshot | null = null,
    bounds: Bounds | null = null,
  ): BrowserWindow => {
    const window = createWindow(bounds)
    const info = windows.add({ window, startupPaths: paths, projectRoot, session })
    window.on('closed', () => {
      ptyManager.killOwnedBy(window.webContents)
      windows.remove(info.windowId)
      if (!quitting) sessionStore.remove(info.windowId)
    })
    return window
  }

  registerHandlers({
    config,
    keymap,
    dirty,
    pty: ptyManager,
    watch,
    expected,
    home: app.getPath('home'),
    windows,
    openWindow: (projectRoot) => void openWindow([], projectRoot),
    session: sessionStore,
    index,
    search,
    replace,
  })
  registerLogChannel()
  installMenu()
  ipcMain.on(channels.perfFirstPaint, markFirstPaint)
  if (isTest) exposeTestGlobals()

  const savedSession = await sessionStore.load()
  const saved = savedSession?.windows ?? []
  const first =
    saved.length === 0
      ? openWindow(startupPaths(), startupRoot())
      : (saved.map((w, i) =>
          openWindow(
            i === 0 ? startupPaths() : [],
            i === 0 ? (startupRoot() ?? w.snapshot.projectRoot) : w.snapshot.projectRoot,
            w.snapshot,
            w.bounds,
          ),
        )[0] as BrowserWindow)
  await sessionStore.markCleanExit(false)
  first.webContents.on('did-finish-load', markDidFinishLoad)
  installCrashHooks(() => first.webContents.reload())

  app.on('before-quit', (event) => {
    const hotExit = config.snapshot().settings.files.hotExit
    if (!hotExit && !quitConfirmed) {
      event.preventDefault()
      void dirty.list().then((entries) => {
        if (entries.length === 0 || dialog.showMessageBoxSync({ type: 'warning', message: 'Quit without saving?', buttons: ['Quit', 'Cancel'], cancelId: 1 }) === 0) {
          quitConfirmed = true
          app.quit()
        } else {
          quitting = false
        }
      })
      return
    }
    void sessionStore.markCleanExit(true)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow([], startupRoot())
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
