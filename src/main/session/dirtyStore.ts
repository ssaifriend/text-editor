import { mkdir, readdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { A, pipe } from '@mobily/ts-belt'
import { DirtyEntry } from '@shared/ipc'
import { writeAtomically } from '../fs/atomic'

export type DirtyStore = {
  readonly write: (entry: DirtyEntry) => Promise<void>
  readonly clear: (id: string) => Promise<void>
  readonly list: () => Promise<DirtyEntry[]>
}

const codeOf = (e: unknown): string | undefined => (e as { code?: string })?.code

const parseEntry = (text: string): DirtyEntry | null => {
  try {
    const parsed = DirtyEntry.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const createDirtyStore = (userData: string, windowId = 'main'): DirtyStore => {
  const dir = join(userData, 'dirty', windowId)
  const fileFor = (id: string): string => join(dir, `${encodeURIComponent(id)}.json`)

  const write = async (entry: DirtyEntry): Promise<void> => {
    await mkdir(dir, { recursive: true })
    await writeAtomically(fileFor(entry.id), Buffer.from(JSON.stringify(entry), 'utf8'))
  }

  const clear = async (id: string): Promise<void> => {
    try {
      await unlink(fileFor(id))
    } catch (e) {
      if (codeOf(e) !== 'ENOENT') throw e
    }
  }

  const list = async (): Promise<DirtyEntry[]> => {
    try {
      const names = await readdir(dir)
      const texts = await Promise.all(
        pipe(
          names,
          A.filter((n) => n.endsWith('.json')),
          A.map((n) => readFile(join(dir, n), 'utf8')),
        ),
      )
      return pipe(
        texts,
        A.map(parseEntry),
        A.filter((e): e is DirtyEntry => e !== null),
        (xs) => [...xs],
      )
    } catch (e) {
      if (codeOf(e) === 'ENOENT') return []
      throw e
    }
  }

  return { write, clear, list }
}
