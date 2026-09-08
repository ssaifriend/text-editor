import { access, rename, writeFile } from 'node:fs/promises'
import { shell } from 'electron'
import { type IpcResult, ok, err } from '@shared/result'

type IoError = { kind: 'io'; message: string }

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export const createFile = async (path: string): Promise<IpcResult<true, IoError>> => {
  try {
    await writeFile(path, '', { flag: 'wx' })
    return ok(true as const)
  } catch (e) {
    return err({ kind: 'io', message: messageOf(e) })
  }
}

export const renamePath = async (from: string, to: string): Promise<IpcResult<true, IoError>> => {
  if (await exists(to)) return err({ kind: 'io', message: `${to} already exists` })
  try {
    await rename(from, to)
    return ok(true as const)
  } catch (e) {
    return err({ kind: 'io', message: messageOf(e) })
  }
}

export const trashPath = async (path: string): Promise<IpcResult<true, IoError>> => {
  try {
    await shell.trashItem(path)
    return ok(true as const)
  } catch (e) {
    return err({ kind: 'io', message: messageOf(e) })
  }
}
