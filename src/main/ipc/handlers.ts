import { existsSync } from 'node:fs'
import { dialog, ipcMain } from 'electron'
import { channels } from '@shared/channels'
import { CloseChoice, PtyAck } from '@shared/ipc'
import { WindowSnapshot } from '@shared/session'
import { ok } from '@shared/result'
import type { ConfigService, KeymapService } from '../config/service'
import { createFile, renamePath, trashPath } from '../fs/ops'
import { readTextFile } from '../fs/read'
import { listDirectory } from '../fs/tree'
import type { IndexService } from '../index/service'
import { writeTextFile } from '../fs/write'
import type { PtyManager } from '../pty/manager'
import type { DirtyStore } from '../session/dirtyStore'
import type { SessionStore } from '../session/sessionStore'
import type { ExpectedWrites } from '../watch/expected'
import type { WatchService } from '../watch/service'
import type { WindowRegistry } from '../windows'
import { handle } from './register'

const isTest = process.env['MORU_TEST'] === '1'

export type HandlerDeps = {
  readonly config: ConfigService
  readonly keymap: KeymapService
  readonly dirty: DirtyStore
  readonly pty: PtyManager
  readonly watch: WatchService
  readonly expected: ExpectedWrites
  readonly home: string
  readonly windows: WindowRegistry
  readonly openWindow: (projectRoot: string | null) => void
  readonly session: SessionStore
  readonly index: IndexService
}

export const registerHandlers = ({
  config,
  keymap,
  dirty,
  pty,
  watch,
  expected,
  home,
  windows,
  openWindow,
  session,
  index,
}: HandlerDeps): void => {
  handle('app.bootstrap', async (_request, { sender }) => {
    const info = windows.bySender(sender)
    return ok({
      paths: [...(info?.startupPaths ?? [])],
      projectRoot: info?.projectRoot ?? null,
      windowId: info?.windowId ?? 'unknown',
      session: info?.session ?? null,
      test: isTest,
    })
  })

  handle('session.load', async () => ok({ session: await session.load() }))

  handle('index.build', async ({ root }) => ok(await index.build(root)))

  handle('index.query', async ({ text, limit }) => ok({ items: index.query(text, limit) }))

  ipcMain.on(channels.sessionSave, (event, raw: unknown) => {
    const parsed = WindowSnapshot.safeParse(raw)
    const info = windows.bySender(event.sender)
    if (!parsed.success || !info) return
    session.update(info.windowId, parsed.data, info.window.isDestroyed() ? null : info.window.getBounds())
  })

  handle('window.new', async (_request, { sender }) => {
    openWindow(windows.bySender(sender)?.projectRoot ?? null)
    return ok(true as const)
  })

  handle('fs.tree', ({ dir }) => listDirectory(dir))
  handle('fs.create', ({ path }) => createFile(path))
  handle('fs.rename', ({ from, to }) => renamePath(from, to))
  handle('fs.delete', ({ path }) => trashPath(path))

  handle('dialog.openFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return ok({ path: canceled ? null : (filePaths[0] ?? null) })
  })

  handle('fs.open', ({ path, encoding }) => readTextFile(path, encoding))

  handle('fs.save', (request) => writeTextFile(request, (path, hash) => expected.record(path, hash)))

  handle('fs.watch', async ({ path }) => {
    await watch.watch(path)
    return ok(true as const)
  })

  handle('fs.unwatch', async ({ path }) => {
    await watch.unwatch(path)
    return ok(true as const)
  })

  handle('dialog.openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'] })
    return ok({ path: canceled ? null : (filePaths[0] ?? null) })
  })

  handle('dialog.saveFile', async (defaultPath) => {
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: defaultPath ?? undefined })
    return ok({ path: canceled || !filePath ? null : filePath })
  })

  handle('dialog.confirmClose', async ({ title }) => {
    if (isTest) return ok({ choice: CloseChoice.parse(process.env['MORU_TEST_CONFIRM'] ?? 'dontSave') })

    const { response } = await dialog.showMessageBox({
      type: 'warning',
      message: `Save changes to ${title}?`,
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    })
    const choices: CloseChoice[] = ['save', 'dontSave', 'cancel']
    return ok({ choice: choices[response] ?? 'cancel' })
  })

  handle('config.get', async () => ok(config.snapshot()))

  handle('keymap.get', async () => ok(keymap.snapshot()))

  handle('dirty.write', async (entry) => {
    await dirty.write(entry)
    return ok(true as const)
  })

  handle('dirty.clear', async (id) => {
    await dirty.clear(id)
    return ok(true as const)
  })

  handle('dirty.list', async () => ok(await dirty.list()))

  handle('pty.spawn', async ({ cwd, cols, rows }, { sender }) => {
    const dir = cwd && existsSync(cwd) ? cwd : home
    const { id, pid } = pty.spawn({ cwd: dir, cols, rows, owner: sender })
    return ok({ id, pid, cwd: dir })
  })

  handle('pty.write', async ({ id, data }) => {
    pty.write(id, data)
    return ok(true as const)
  })

  handle('pty.resize', async ({ id, cols, rows }) => {
    pty.resize(id, cols, rows)
    return ok(true as const)
  })

  handle('pty.kill', async ({ id }) => {
    pty.kill(id)
    return ok(true as const)
  })

  handle('pty.isAlive', async ({ id }) => ok(pty.isAlive(id)))

  ipcMain.on(channels.ptyAck, (_event, raw: unknown) => {
    const parsed = PtyAck.safeParse(raw)
    if (parsed.success) pty.ack(parsed.data.id, parsed.data.bytes)
  })
}
