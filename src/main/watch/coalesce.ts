export type Coalescer = { readonly touch: (path: string) => void; readonly dispose: () => void }

export const createCoalescer = (delayMs: number, onFlush: (path: string) => void): Coalescer => {
  let timers: Record<string, ReturnType<typeof setTimeout>> = {}

  return {
    touch: (path) => {
      const existing = timers[path]
      if (existing) clearTimeout(existing)
      timers = {
        ...timers,
        [path]: setTimeout(() => {
          const { [path]: _dropped, ...rest } = timers
          timers = rest
          onFlush(path)
        }, delayMs),
      }
    },
    dispose: () => {
      Object.values(timers).forEach(clearTimeout)
      timers = {}
    },
  }
}
