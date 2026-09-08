import { randomBytes } from 'node:crypto'
import { chmod, open, realpath, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const retryableRenameCodes = ['EPERM', 'EBUSY', 'EACCES']
const renameRetries = 3
const renameRetryDelayMs = 50

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const codeOf = (e: unknown): string | undefined => (e as { code?: string })?.code

const resolveTarget = async (path: string): Promise<string> => {
  try {
    return await realpath(path)
  } catch (e) {
    if (codeOf(e) === 'ENOENT') return path
    throw e
  }
}

const modeOf = async (path: string): Promise<number | null> => {
  try {
    return (await stat(path)).mode & 0o777
  } catch (e) {
    if (codeOf(e) === 'ENOENT') return null
    throw e
  }
}

const writeAndSync = async (path: string, bytes: Buffer): Promise<void> => {
  const handle = await open(path, 'w')
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

const renameWithRetry = async (from: string, to: string, attempt = 1): Promise<void> => {
  try {
    await rename(from, to)
  } catch (e) {
    const retry =
      process.platform === 'win32' && attempt < renameRetries && retryableRenameCodes.includes(codeOf(e) ?? '')
    if (!retry) throw e
    await sleep(renameRetryDelayMs)
    await renameWithRetry(from, to, attempt + 1)
  }
}

export const writeAtomically = async (path: string, bytes: Buffer): Promise<void> => {
  const target = await resolveTarget(path)
  const tmp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`)

  try {
    await writeAndSync(tmp, bytes)

    const mode = await modeOf(target)
    if (mode !== null && process.platform !== 'win32') await chmod(tmp, mode)

    await renameWithRetry(tmp, target)
  } catch (e) {
    const tmpExists = (await modeOf(tmp).catch(() => null)) !== null
    if (tmpExists && codeOf(e) === 'ENOENT') await unlink(tmp).catch(() => undefined)
    const suffix = tmpExists && codeOf(e) !== 'ENOENT' ? ` (unsaved bytes kept at ${tmp})` : ''
    throw new Error(`${e instanceof Error ? e.message : String(e)}${suffix}`)
  }
}
