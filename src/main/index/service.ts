import { join } from 'node:path'
import type { AsyncSubscription, Event, Options } from '@parcel/watcher'
import { Fzf } from 'fzf'
import type { PushChannel, PushPayload } from '@shared/ipc'
import { listFiles } from './list'

export type IndexItem = { readonly rel: string; readonly path: string; readonly positions: number[]; readonly score: number }

export type Matcher = { readonly query: (text: string, limit: number) => IndexItem[]; readonly size: number }

export const createMatcher = (rel: readonly string[], root: string): Matcher => {
  const fzf = new Fzf(rel as string[], { selector: (s) => s, limit: 200, casing: 'smart-case' })
  return {
    size: rel.length,
    query: (text, limit) =>
      text.trim() === ''
        ? rel.slice(0, limit).map((r) => ({ rel: r, path: join(root, r), positions: [], score: 0 }))
        : fzf
            .find(text)
            .slice(0, limit)
            .map((m) => ({
              rel: m.item,
              path: join(root, m.item),
              positions: [...m.positions].sort((a, b) => a - b),
              score: m.score,
            })),
  }
}

type Subscribe = (
  dir: string,
  cb: (err: Error | null, events: Event[]) => void,
  opts?: Options,
) => Promise<AsyncSubscription>
type Push = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

type Deps = { readonly rgPath: string; readonly subscribe: Subscribe; readonly push: Push; readonly debounceMs?: number }

export type IndexService = {
  readonly build: (root: string) => Promise<{ files: number; truncated: boolean }>
  readonly query: (text: string, limit: number) => Promise<IndexItem[]>
  readonly root: () => string | null
  readonly dispose: () => Promise<void>
}

export const createIndexService = ({ rgPath, subscribe, push, debounceMs = 500 }: Deps): IndexService => {
  let root: string | null = null
  let matcher: Matcher | null = null
  let subscription: AsyncSubscription | null = null
  let timer: NodeJS.Timeout | null = null
  let building: Promise<unknown> = Promise.resolve()

  const rebuild = async (): Promise<{ files: number; truncated: boolean }> => {
    if (!root) return { files: 0, truncated: false }
    const { files, truncated } = await listFiles(root, rgPath)
    matcher = createMatcher(files, root)
    return { files: files.length, truncated }
  }

  const scheduleRebuild = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void rebuild().then((r) => push('index.changed', { files: r.files })), debounceMs)
  }

  const build = (nextRoot: string): Promise<{ files: number; truncated: boolean }> => {
    const run = async () => {
      if (subscription) await subscription.unsubscribe()
      root = nextRoot
      subscription = await subscribe(
        nextRoot,
        (err, events) => {
          if (!err && events.some((e) => e.type !== 'update')) scheduleRebuild()
        },
        { ignore: ['**/node_modules/**', '**/.git/**'] },
      )
      return rebuild()
    }
    building = run()
    return building as Promise<{ files: number; truncated: boolean }>
  }

  return {
    build,
    query: async (text, limit) => {
      await building.catch(() => undefined)
      return matcher?.query(text, limit) ?? []
    },
    root: () => root,
    dispose: async () => {
      if (timer) clearTimeout(timer)
      await subscription?.unsubscribe()
      subscription = null
    },
  }
}
