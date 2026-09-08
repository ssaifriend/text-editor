import { readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { type Bounds, type SessionFile, SessionFile as SessionFileSchema, type WindowSnapshot } from '@shared/session'
import { writeAtomically } from '../fs/atomic'

type Entry = { readonly snapshot: WindowSnapshot; readonly bounds: Bounds | null }

export type SessionStore = {
  readonly load: () => Promise<SessionFile | null>
  readonly update: (windowId: string, snapshot: WindowSnapshot, bounds: Bounds | null) => void
  readonly remove: (windowId: string) => void
  readonly markCleanExit: (clean: boolean) => Promise<void>
  readonly flush: () => Promise<void>
}

const codeOf = (e: unknown): string | undefined => (e as { code?: string })?.code

export const createSessionStore = (userData: string, { debounceMs = 300 }: { debounceMs?: number } = {}): SessionStore => {
  const path = join(userData, 'session.json')
  let entries: Record<string, Entry> = {}
  let order: string[] = []
  let cleanExit = false
  let timer: NodeJS.Timeout | null = null

  const current = (): SessionFile => ({
    version: 1,
    cleanExit,
    windows: order.flatMap((id) => (entries[id] ? [entries[id] as Entry] : [])),
  })

  const write = async (): Promise<void> => {
    await writeAtomically(path, Buffer.from(JSON.stringify(current(), null, 2), 'utf8'))
  }

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void write(), debounceMs)
  }

  const load = async (): Promise<SessionFile | null> => {
    try {
      const parsed = SessionFileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
      if (parsed.success) return parsed.data
    } catch (e) {
      if (codeOf(e) === 'ENOENT') return null
    }
    await rename(path, join(userData, `session.corrupt.${Date.now()}.json`)).catch(() => undefined)
    return null
  }

  return {
    load,
    update: (windowId, snapshot, bounds) => {
      if (!entries[windowId]) order = [...order, windowId]
      entries = { ...entries, [windowId]: { snapshot, bounds } }
      schedule()
    },
    remove: (windowId) => {
      const { [windowId]: _dropped, ...rest } = entries
      entries = rest
      order = order.filter((id) => id !== windowId)
      schedule()
    },
    markCleanExit: async (clean) => {
      cleanExit = clean
      if (timer) clearTimeout(timer)
      await write()
    },
    flush: async () => {
      if (timer) clearTimeout(timer)
      await write()
    },
  }
}
