import { access, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { EncodingName } from '@shared/encoding'
import type { OpenedFile, OpenError } from '@shared/ipc'
import { type IpcResult, ok, err } from '@shared/result'
import { decodeBytes, detectEncoding } from './encoding'
import { detectEol, normalizeToLf } from './eol'
import { hashBytes } from './hash'

const largeFileBytes = 20 * 1024 * 1024
const binarySniffBytes = 8 * 1024

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const looksBinary = (bytes: Buffer): boolean => bytes.subarray(0, binarySniffBytes).includes(0)

const isWritable = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

export const readTextFile = async (
  path: string,
  forcedEncoding?: EncodingName,
): Promise<IpcResult<OpenedFile, OpenError>> => {
  try {
    const [bytes, info, writable] = await Promise.all([readFile(path), stat(path), isWritable(path)])

    if (looksBinary(bytes)) return err({ kind: 'binary', message: `${path} contains NUL bytes` })

    const detected = detectEncoding(bytes)
    const encoding = forcedEncoding ?? detected.encoding
    const bom = forcedEncoding ? detected.bom && forcedEncoding === detected.encoding : detected.bom
    const confidence = forcedEncoding ? 'high' : detected.confidence

    const raw = decodeBytes(bytes, encoding)
    const { eol, mixed } = detectEol(raw)

    return ok({
      path,
      text: normalizeToLf(raw),
      encoding,
      bom,
      eol,
      mixedEol: mixed,
      confidence,
      hash: hashBytes(bytes),
      mtimeMs: info.mtimeMs,
      readonly: !writable,
      largeFile: bytes.length > largeFileBytes,
    })
  } catch (e) {
    return err({ kind: 'io', message: messageOf(e) })
  }
}
