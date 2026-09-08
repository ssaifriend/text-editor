import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AsyncSubscription, Event, Options } from '@parcel/watcher'
import type { PushChannel, PushPayload } from '@shared/ipc'
import { hashBytes } from '../fs/hash'
import { createCoalescer } from './coalesce'
import type { ExpectedWrites } from './expected'

type Subscribe = (
  dir: string,
  cb: (err: Error | null, events: Event[]) => void,
  opts?: Options,
) => Promise<AsyncSubscription>
type Push = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

type Deps = {
  readonly subscribe: Subscribe
  readonly push: Push
  readonly expected: ExpectedWrites
  readonly delayMs?: number
}

type DirEntry = { readonly subscription: AsyncSubscription; readonly count: number }

export type WatchService = {
  readonly watch: (path: string) => Promise<void>
  readonly unwatch: (path: string) => Promise<void>
  readonly dispose: () => Promise<void>
}

const codeOf = (e: unknown): string | undefined => (e as { code?: string })?.code

const realDirOf = async (path: string): Promise<string> => {
  const dir = dirname(path)
  try {
    return await realpath(dir)
  } catch {
    return dir
  }
}

const basenameOf = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)

export const createWatchService = ({ subscribe, push, expected, delayMs = 100 }: Deps): WatchService => {
  let watched: Record<string, string> = {}
  let realOf: Record<string, string> = {}
  let dirs: Record<string, DirEntry> = {}

  const settle = async (realPath: string): Promise<void> => {
    const path = watched[realPath]
    if (!path) return
    try {
      const [bytes, info] = await Promise.all([readFile(path), stat(path)])
      const hash = hashBytes(bytes)
      if (expected.consume(path, hash)) return
      push('fs.changed', { path, hash, mtimeMs: info.mtimeMs })
    } catch (e) {
      if (codeOf(e) === 'ENOENT') push('fs.deleted', { path })
    }
  }

  const coalescer = createCoalescer(delayMs, (realPath) => void settle(realPath))

  const onEvents = (err: Error | null, events: Event[]): void => {
    if (err) return
    events.filter((event) => watched[event.path] !== undefined).forEach((event) => coalescer.touch(event.path))
  }

  const watch = async (path: string): Promise<void> => {
    if (realOf[path]) return
    const dir = await realDirOf(path)
    const realPath = `${dir}/${basenameOf(path)}`
    watched = { ...watched, [realPath]: path }
    realOf = { ...realOf, [path]: realPath }

    const existing = dirs[dir]
    if (existing) {
      dirs = { ...dirs, [dir]: { ...existing, count: existing.count + 1 } }
      return
    }
    const subscription = await subscribe(dir, onEvents, { ignore: ['**/node_modules/**', '**/.git/**'] })
    dirs = { ...dirs, [dir]: { subscription, count: 1 } }
  }

  const unwatch = async (path: string): Promise<void> => {
    const realPath = realOf[path]
    if (!realPath) return
    const { [realPath]: _dropped, ...restWatched } = watched
    watched = restWatched
    const { [path]: _gone, ...restReal } = realOf
    realOf = restReal

    const dir = dirname(realPath)
    const entry = dirs[dir]
    if (!entry) return
    if (entry.count > 1) {
      dirs = { ...dirs, [dir]: { ...entry, count: entry.count - 1 } }
      return
    }
    const { [dir]: _removed, ...restDirs } = dirs
    dirs = restDirs
    await entry.subscription.unsubscribe()
  }

  return {
    watch,
    unwatch,
    dispose: async () => {
      coalescer.dispose()
      await Promise.all(Object.values(dirs).map((d) => d.subscription.unsubscribe()))
      dirs = {}
      watched = {}
      realOf = {}
    },
  }
}
