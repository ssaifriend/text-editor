export type ExpectedWrites = {
  readonly record: (path: string, hash: string) => void
  readonly consume: (path: string, hash: string) => boolean
}

type Entry = { readonly hash: string; readonly at: number }

export const createExpectedWrites = (now: () => number = Date.now, ttlMs = 10_000): ExpectedWrites => {
  let entries: Record<string, Entry> = {}

  return {
    record: (path, hash) => {
      entries = { ...entries, [path]: { hash, at: now() } }
    },
    consume: (path, hash) => {
      const entry = entries[path]
      if (!entry) return false
      const { [path]: _dropped, ...rest } = entries
      entries = rest
      return entry.hash === hash && now() - entry.at <= ttlMs
    },
  }
}
