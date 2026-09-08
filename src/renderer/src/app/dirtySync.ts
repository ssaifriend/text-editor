import type { DirtyEntry } from '@shared/ipc'

type Deps = {
  readonly write: (entry: DirtyEntry) => Promise<unknown>
  readonly clear: (id: string) => Promise<unknown>
  readonly delayMs?: number
  readonly maxDelayMs?: number
}

export type DirtySync = {
  readonly changed: (entry: DirtyEntry, dirty: boolean) => void
  readonly flush: () => Promise<void>
  readonly dispose: () => void
}

type Pending = { readonly entry: DirtyEntry; readonly firstChangeAt: number; readonly timer: ReturnType<typeof setTimeout> }

const without = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _dropped, ...rest } = record
  return rest
}

export const createDirtySync = ({ write, clear, delayMs = 1000, maxDelayMs = 5000 }: Deps): DirtySync => {
  let pending: Record<string, Pending> = {}
  let written: Record<string, true> = {}

  const commit = async (id: string): Promise<void> => {
    const p = pending[id]
    if (!p) return
    clearTimeout(p.timer)
    pending = without(pending, id)
    written = { ...written, [id]: true }
    await write(p.entry)
  }

  const schedule = (entry: DirtyEntry): void => {
    const previous = pending[entry.id]
    if (previous) clearTimeout(previous.timer)

    const firstChangeAt = previous?.firstChangeAt ?? Date.now()
    const wait = Math.max(0, Math.min(delayMs, firstChangeAt + maxDelayMs - Date.now()))
    const timer = setTimeout(() => void commit(entry.id), wait)
    pending = { ...pending, [entry.id]: { entry, firstChangeAt, timer } }
  }

  const changed = (entry: DirtyEntry, dirty: boolean): void => {
    if (dirty) {
      schedule(entry)
      return
    }

    const p = pending[entry.id]
    if (p) {
      clearTimeout(p.timer)
      pending = without(pending, entry.id)
    }
    if (written[entry.id]) {
      written = without(written, entry.id)
      void clear(entry.id)
    }
  }

  const flush = async (): Promise<void> => {
    await Promise.all(Object.keys(pending).map(commit))
  }

  const dispose = (): void => {
    Object.values(pending).forEach((p) => clearTimeout(p.timer))
    pending = {}
  }

  return { changed, flush, dispose }
}
