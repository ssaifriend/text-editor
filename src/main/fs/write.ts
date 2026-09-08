import { writeFile } from 'node:fs/promises'
import type { SaveRequest, SavedMeta, SaveError } from '@shared/ipc'
import { type IpcResult, ok, err } from '@shared/result'

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const writeTextFile = async ({ path, text }: SaveRequest): Promise<IpcResult<SavedMeta, SaveError>> => {
  try {
    await writeFile(path, text, 'utf8')
    return ok({ path, bytes: Buffer.byteLength(text, 'utf8') })
  } catch (e) {
    return err({ kind: 'io', message: messageOf(e) })
  }
}
