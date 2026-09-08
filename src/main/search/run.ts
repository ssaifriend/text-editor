import { type ChildProcessByStdio, spawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import { createInterface } from 'node:readline'
import type { PushChannel, PushPayload } from '@shared/ipc'
import type { SearchMatch, SearchSpec } from '@shared/search'
import { type RgOptions, rgArgs } from './args'
import { parseRgLine } from './rgJson'

type Push = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

type Deps = {
  readonly rgPath: string
  readonly push: Push
  readonly settings: () => RgOptions
  readonly batchMs?: number
  readonly cap?: number
}

export type SearchService = {
  readonly run: (id: string, spec: SearchSpec, roots: readonly string[]) => void
  readonly cancel: (id: string) => void
  readonly dispose: () => void
}

type Running = { readonly child: ChildProcessByStdio<null, Readable, Readable>; cancelled: boolean }

export const createSearchService = ({ rgPath, push, settings, batchMs = 50, cap = 10_000 }: Deps): SearchService => {
  const running: Record<string, Running> = {}

  const kill = (id: string): void => {
    const entry = running[id]
    if (!entry) return
    entry.cancelled = true
    entry.child.kill()
    delete running[id]
  }

  const run = (id: string, spec: SearchSpec, roots: readonly string[]): void => {
    kill(id)
    const child = spawn(rgPath, rgArgs(spec, roots, settings()), { stdio: ['ignore', 'pipe', 'pipe'] })
    const entry: Running = { child, cancelled: false }
    running[id] = entry

    let pending: SearchMatch[] = []
    let files = 0
    let total = 0
    let truncated = false
    let stderr = ''

    const flush = (): void => {
      if (pending.length === 0) return
      push('search.batch', { id, matches: pending })
      pending = []
    }
    const timer = setInterval(flush, batchMs)

    createInterface({ input: child.stdout }).on('line', (line) => {
      const event = parseRgLine(line)
      if (event.kind === 'end') files += 1
      if (event.kind !== 'match' || truncated) return

      pending.push(...event.matches)
      total += event.matches.length
      if (total >= cap) {
        truncated = true
        child.kill()
      }
    })
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))

    const finish = (error: string | null): void => {
      clearInterval(timer)
      if (running[id] === entry) delete running[id]
      if (entry.cancelled) return
      flush()
      push('search.done', { id, files, matches: total, truncated, error })
    }
    child.on('error', (e: NodeJS.ErrnoException) => finish(e.code === 'ENOENT' ? 'ripgrep not found' : e.message))
    child.on('close', (code) => finish(code === 2 && !truncated ? stderr.trim().slice(0, 300) || 'ripgrep failed' : null))
  }

  return {
    run,
    cancel: kill,
    dispose: () => Object.keys(running).forEach(kill),
  }
}
