import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { A, pipe } from '@mobily/ts-belt'
import type { TreeEntry } from '@shared/ipc'
import { type IpcResult, ok, err } from '@shared/result'

const skipped = ['.git', 'node_modules', '.DS_Store']

const byName = (a: TreeEntry, b: TreeEntry): number => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

export const listDirectory = async (dir: string): Promise<IpcResult<TreeEntry[], { kind: 'io'; message: string }>> => {
  try {
    const dirents = await readdir(dir, { withFileTypes: true })
    const entries = pipe(
      dirents,
      A.filter((d) => !skipped.includes(d.name)),
      A.map((d): TreeEntry => ({ name: d.name, path: join(dir, d.name), kind: d.isDirectory() ? 'dir' : 'file' })),
    )
    const dirs = [...entries.filter((e) => e.kind === 'dir')].sort(byName)
    const files = [...entries.filter((e) => e.kind === 'file')].sort(byName)
    return ok([...dirs, ...files])
  } catch (e) {
    return err({ kind: 'io', message: e instanceof Error ? e.message : String(e) })
  }
}
