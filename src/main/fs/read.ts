import { readFile } from 'node:fs/promises'
import type { OpenedFile, OpenError } from '@shared/ipc'
import { type IpcResult, ok, err } from '@shared/result'

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const readTextFile = async (path: string): Promise<IpcResult<OpenedFile, OpenError>> => {
  try {
    const text = await readFile(path, 'utf8')
    return ok({ path, text })
  } catch (e) {
    return err({ kind: 'io', message: messageOf(e) })
  }
}
