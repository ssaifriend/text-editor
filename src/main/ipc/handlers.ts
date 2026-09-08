import { dialog } from 'electron'
import { ok } from '@shared/result'
import type { ConfigService } from '../config/service'
import { readTextFile } from '../fs/read'
import { writeTextFile } from '../fs/write'
import type { DirtyStore } from '../session/dirtyStore'
import { handle } from './register'

const isTest = process.env['MORU_TEST'] === '1'

export type HandlerDeps = {
  readonly config: ConfigService
  readonly dirty: DirtyStore
  readonly startupPaths: readonly string[]
}

export const registerHandlers = ({ config, dirty, startupPaths }: HandlerDeps): void => {
  handle('app.bootstrap', async () => ok({ paths: [...startupPaths], test: isTest }))

  handle('fs.open', ({ path, encoding }) => readTextFile(path, encoding))

  handle('fs.save', writeTextFile)

  handle('dialog.openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'] })
    return ok({ path: canceled ? null : (filePaths[0] ?? null) })
  })

  handle('dialog.saveFile', async (defaultPath) => {
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: defaultPath ?? undefined })
    return ok({ path: canceled || !filePath ? null : filePath })
  })

  handle('config.get', async () => ok(config.snapshot()))

  handle('dirty.write', async (entry) => {
    await dirty.write(entry)
    return ok(true as const)
  })

  handle('dirty.clear', async (id) => {
    await dirty.clear(id)
    return ok(true as const)
  })

  handle('dirty.list', async () => ok(await dirty.list()))
}
