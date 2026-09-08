import type { WebContents } from 'electron'
import * as pty from 'node-pty'
import type { PushChannel, PushPayload } from '@shared/ipc'
import { type FlowControl, createFlowControl } from './flowControl'

type Push = <C extends PushChannel>(owner: WebContents, channel: C, payload: PushPayload<C>) => void

type Deps = {
  readonly push: Push
  readonly env: Record<string, string>
  readonly shell: string
  readonly stallMs?: number
}

type Entry = {
  readonly proc: pty.IPty
  readonly flow: FlowControl
  readonly owner: WebContents
  alive: boolean
  stall: NodeJS.Timeout | null
}

export type SpawnOptions = { readonly cwd: string; readonly cols: number; readonly rows: number; readonly owner: WebContents }

export type PtyManager = {
  readonly spawn: (options: SpawnOptions) => { id: string; pid: number }
  readonly write: (id: string, data: string) => void
  readonly resize: (id: string, cols: number, rows: number) => void
  readonly kill: (id: string) => void
  readonly ack: (id: string, bytes: number) => void
  readonly isAlive: (id: string) => boolean
  readonly killOwnedBy: (owner: WebContents) => void
  readonly disposeAll: () => void
}

export const createPtyManager = ({ push, env, shell, stallMs = 5000 }: Deps): PtyManager => {
  let entries: Record<string, Entry> = {}
  let counter = 0

  const clearStall = (entry: Entry): void => {
    if (entry.stall) clearTimeout(entry.stall)
    entry.stall = null
  }

  const pause = (entry: Entry): void => {
    entry.proc.pause()
    entry.stall = setTimeout(() => {
      entry.proc.resume()
      entry.stall = null
    }, stallMs)
  }

  const spawn = ({ cwd, cols, rows, owner }: SpawnOptions): { id: string; pid: number } => {
    const id = `pty${(counter += 1)}`
    const proc = pty.spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd, env })
    const entry: Entry = { proc, flow: createFlowControl(), owner, alive: true, stall: null }
    entries = { ...entries, [id]: entry }

    proc.onData((data) => {
      push(owner, 'pty.data', { id, data })
      if (entry.flow.sent(Buffer.byteLength(data, 'utf8')) === 'pause') pause(entry)
    })
    proc.onExit(({ exitCode }) => {
      entry.alive = false
      clearStall(entry)
      push(owner, 'pty.exit', { id, exitCode })
    })

    return { id, pid: proc.pid }
  }

  const kill = (id: string): void => {
    const entry = entries[id]
    if (!entry) return
    clearStall(entry)
    if (entry.alive) entry.proc.kill()
    const { [id]: _dropped, ...rest } = entries
    entries = rest
  }

  return {
    spawn,
    write: (id, data) => entries[id]?.proc.write(data),
    resize: (id, cols, rows) => {
      const entry = entries[id]
      if (entry?.alive && cols > 0 && rows > 0) entry.proc.resize(cols, rows)
    },
    kill,
    ack: (id, bytes) => {
      const entry = entries[id]
      if (!entry) return
      if (entry.flow.acked(bytes) === 'resume') {
        clearStall(entry)
        entry.proc.resume()
      }
    },
    isAlive: (id) => entries[id]?.alive ?? false,
    killOwnedBy: (owner) => {
      Object.entries(entries)
        .filter(([, entry]) => entry.owner === owner)
        .forEach(([id]) => kill(id))
    },
    disposeAll: () => {
      Object.keys(entries).forEach(kill)
    },
  }
}
