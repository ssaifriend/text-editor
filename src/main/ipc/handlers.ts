import { dialog } from 'electron'
import { ok } from '@shared/result'
import { readTextFile } from '../fs/read'
import { writeTextFile } from '../fs/write'
import { handle } from './register'

const isTest = process.env['MORU_TEST'] === '1'

export const registerHandlers = (): void => {
  handle('app.bootstrap', async () => ok({ path: process.env['MORU_TEST_OPEN'] ?? null, test: isTest }))

  handle('fs.open', readTextFile)

  handle('fs.save', writeTextFile)

  handle('dialog.openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'] })
    return ok({ path: canceled ? null : (filePaths[0] ?? null) })
  })

  handle('dialog.saveFile', async (defaultPath) => {
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: defaultPath ?? undefined })
    return ok({ path: canceled || !filePath ? null : filePath })
  })
}
