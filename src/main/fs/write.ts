import { readFile, stat } from 'node:fs/promises'
import type { SaveRequest, SavedMeta, SaveError } from '@shared/ipc'
import { type IpcResult, ok, err } from '@shared/result'
import { writeAtomically } from './atomic'
import { encodeLossless } from './encoding'
import { restoreEol } from './eol'
import { hashBytes } from './hash'

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const codeOf = (e: unknown): string | undefined => (e as { code?: string })?.code

const currentHash = async (path: string): Promise<string | null> => {
  try {
    return hashBytes(await readFile(path))
  } catch (e) {
    if (codeOf(e) === 'ENOENT') return null
    throw e
  }
}

const conflictOf = async ({ path, expectedHash, mode }: SaveRequest): Promise<SaveError | null> => {
  if (mode === 'overwrite' || expectedHash === null) return null

  const diskHash = await currentHash(path)
  if (diskHash === null || diskHash === expectedHash) return null

  return { kind: 'conflict', message: `${path} changed on disk since it was opened`, diskHash }
}

export const writeTextFile = async (request: SaveRequest): Promise<IpcResult<SavedMeta, SaveError>> => {
  try {
    const conflict = await conflictOf(request)
    if (conflict) return err(conflict)

    const encoded = encodeLossless(restoreEol(request.text, request.eol), request.encoding, request.bom)
    if (!encoded.ok) {
      return err({
        kind: 'encodingLossy',
        message: `${encoded.positions.length} character(s) cannot be represented in ${request.encoding}`,
        positions: encoded.positions,
      })
    }

    await writeAtomically(request.path, encoded.bytes)
    const info = await stat(request.path)

    return ok({
      path: request.path,
      bytes: encoded.bytes.length,
      hash: hashBytes(encoded.bytes),
      mtimeMs: info.mtimeMs,
    })
  } catch (e) {
    const kind = codeOf(e) === 'EACCES' || codeOf(e) === 'EPERM' ? 'readonly' : 'io'
    return err({ kind, message: messageOf(e) })
  }
}
