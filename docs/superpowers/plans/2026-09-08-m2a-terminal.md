# M2a Terminal Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A terminal tab kind — node-pty in main, xterm.js in the renderer — that can host Claude Code / Codex next to the editor: login-shell environment, ack-based flow control, reserved keys, file-path links, send-selection/path/`@path` commands, exit overlay with restart, theme and font shared with the editor.

**Architecture:** `main/pty/manager` owns PTY processes keyed by id, pushes `pty.data`/`pty.exit`, and pauses a PTY when the renderer has more than 1 MB of unacknowledged output. The renderer keeps one `Terminal` per terminal tab in a registry (xterm's `open()` is one-shot, so the DOM element is re-parented when the tab moves); `TerminalHost` mounts the active terminal element into its pane. `Tab` gains `kind: 'terminal'`; the pane tree is unchanged. The keymap gains a `terminalFocus` context in which only tab/view/palette/terminal commands run, so every other key reaches the shell.

**Tech Stack:** node-pty 1.1.0, @xterm/xterm 6.0.0 + addon-webgl 0.19.0 / addon-fit 0.11.0 / addon-unicode11 0.9.0 / addon-web-links 0.12.0 / addon-search 0.16.0.

**Spec:** `docs/superpowers/specs/2026-09-08-text-editor-design.md` — §3.5 pane 모델, §3.6 `when`, §5.5 터미널 (env, cwd, 흐름 제어, 예약 키, 한글, 경로 링크, 전송), §8 M2 수용 기준.

## Global Constraints

- Login-shell environment is resolved **once** at startup by spawning `$SHELL -ilc 'env -0'` with a 3 s timeout (macOS/Linux); Windows uses `process.env`. Always set `TERM=xterm-256color`, `COLORTERM=truecolor`, and a UTF-8 `LANG` if none is set.
- Flow control is ours, not node-pty's experimental one: renderer acks bytes after `term.write` callbacks; main pauses at > 1 MB unacked and resumes below 256 KB; a 5 s stall forces resume.
- xterm needs `Unicode11Addon` with `term.unicode.activeVersion = '11'` (Korean width), `convertEol: false`, `allowProposedApi: true` (link provider).
- In `terminalFocus`, the keymap runs only commands whose id starts with `palette.`, `tab.`, `view.`, `terminal.`, or equals `file.new`. Everything else reaches xterm. `tab.close` on a terminal with a live child asks for confirmation (test mode: `MORU_TEST_CONFIRM`).
- Terminal tabs are not persisted in M2a (session/hot-exit is M3); closing the app kills PTYs.
- TS strict, ts-belt, functional style. Conventional commits.

## File Structure

```
src/shared/channels.ts, ipc.ts          # (modify) pty.* invoke/push contracts
src/main/pty/env.ts                     # resolveShellEnv(), parseEnvNul()
src/main/pty/flowControl.ts             # pure state machine: onSent(bytes), onAck(bytes) → 'pause' | 'resume' | null
src/main/pty/manager.ts                 # createPtyManager({ push }) spawn/write/resize/kill/ack
src/main/ipc/handlers.ts, index.ts, menu.ts  # (modify)

src/renderer/src/terminal/registry.ts   # createTerminalRegistry(): create(id) → { term, element }, get, dispose
src/renderer/src/terminal/links.ts      # filePathLinkProvider(onOpen), parsePathRef(text)
src/renderer/src/terminal/theme.ts      # xtermTheme(Theme): ITheme
src/renderer/src/ui/terminal/TerminalHost.tsx
src/renderer/src/app/workspace.ts       # (modify) terminal tabs, newTerminal, sendToTerminal, terminalFocus
src/renderer/src/app/context.ts         # (modify) terminalFocus, hasTerminal
src/renderer/src/app/useKeymap.ts       # (modify) terminal allow-list
src/renderer/src/app/registerCommands.ts# (modify) terminal.* commands
src/renderer/src/keymap/defaults.ts     # (modify) ctrl+` etc.
src/renderer/src/ui/layout/PaneView.tsx # (modify) render TerminalHost for terminal tabs
src/renderer/src/ui/tabs/TabStrip.tsx   # (modify) title for terminal tabs
src/renderer/src/testHooks.ts           # (modify) terminalText(), terminals()
src/renderer/src/style.css              # (modify)

tests/unit/main/flowControl.test.ts
tests/unit/main/env.test.ts
tests/unit/renderer/links.test.ts
tests/e2e/terminal.spec.ts
docs/superpowers/reports/m2a-terminal.md
```

---

### Task 1: Main PTY manager with login env and flow control

**Files:**
- Create: `src/main/pty/env.ts`, `src/main/pty/flowControl.ts`, `src/main/pty/manager.ts`
- Modify: `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/main/ipc/handlers.ts`, `src/main/index.ts`, `tests/unit/shared/ipc.test.ts`
- Test: `tests/unit/main/flowControl.test.ts`, `tests/unit/main/env.test.ts`

**Interfaces:**
- `parseEnvNul(output: string): Record<string, string>` — splits `env -0` output on `\0`, first `=` separates key/value, skips malformed entries.
- `resolveShellEnv(opts: { platform: NodeJS.Platform; shell: string; spawn: typeof child_process.execFile; timeoutMs?: number }): Promise<Record<string, string>>` — non-win32: run `shell -ilc 'env -0'`, parse, merge over `process.env`; on error/timeout return `process.env`. Always ensures `TERM`, `COLORTERM`, `LANG` (default `en_US.UTF-8` when unset or not containing `UTF-8`).
- `createFlowControl(limits = { pauseAbove: 1_048_576, resumeBelow: 262_144 })` → `{ sent(bytes): 'pause' | null; acked(bytes): 'resume' | null; unacked(): number; paused(): boolean }`.
- `createPtyManager(deps: { push: <C>(channel, payload) => void; env: Record<string,string>; shell: string; stallMs?: number })` → `{ spawn(opts: { cwd: string; cols: number; rows: number }): { id: string; pid: number }; write(id, data): void; resize(id, cols, rows): void; kill(id): void; ack(id, bytes): void; isAlive(id): boolean; disposeAll(): void }`.
- Contracts (invoke): `pty.spawn` `{ cwd: string | null; cols: number; rows: number }` → `{ id: string; pid: number; cwd: string }`; `pty.write` `{ id; data }` → `true`; `pty.resize` `{ id; cols; rows }` → `true`; `pty.kill` `{ id }` → `true`; `pty.ack` (send channel) `{ id; bytes }`. Push: `pty.data` `{ id; data }`, `pty.exit` `{ id; exitCode: number }`.
- Default shell: `process.env.SHELL ?? '/bin/zsh'` on darwin, `/bin/bash` on linux; on win32 `pwsh.exe` if found on PATH else `powershell.exe`.

- [x] **Step 1: Write failing tests**

`tests/unit/main/flowControl.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createFlowControl } from '../../../src/main/pty/flowControl'

describe('flow control', () => {
  it('pauses once above the high mark and resumes once below the low mark', () => {
    const fc = createFlowControl({ pauseAbove: 1000, resumeBelow: 200 })
    expect(fc.sent(600)).toBeNull()
    expect(fc.sent(500)).toBe('pause')
    expect(fc.paused()).toBe(true)
    expect(fc.sent(100)).toBeNull()
    expect(fc.acked(900)).toBeNull()
    expect(fc.acked(200)).toBe('resume')
    expect(fc.paused()).toBe(false)
    expect(fc.unacked()).toBe(100)
  })

  it('never reports negative unacked bytes', () => {
    const fc = createFlowControl()
    fc.sent(10)
    fc.acked(50)
    expect(fc.unacked()).toBe(0)
  })
})
```

`tests/unit/main/env.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { parseEnvNul, resolveShellEnv } from '../../../src/main/pty/env'

describe('parseEnvNul', () => {
  it('splits on NUL and keeps values containing =', () => {
    expect(parseEnvNul('PATH=/a:/b\0FOO=x=y\0BAD\0')).toEqual({ PATH: '/a:/b', FOO: 'x=y' })
  })
})

describe('resolveShellEnv', () => {
  it('merges the login shell env over process.env and forces terminal variables', async () => {
    const spawn = vi.fn((_file: string, _args: readonly string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      cb(null, 'PATH=/opt/homebrew/bin:/usr/bin\0EXTRA=1\0')
      return undefined as never
    })
    const env = await resolveShellEnv({ platform: 'darwin', shell: '/bin/zsh', spawn: spawn as never, base: { HOME: '/Users/x', LANG: 'C' } })
    expect(env['PATH']).toBe('/opt/homebrew/bin:/usr/bin')
    expect(env['EXTRA']).toBe('1')
    expect(env['HOME']).toBe('/Users/x')
    expect(env['TERM']).toBe('xterm-256color')
    expect(env['COLORTERM']).toBe('truecolor')
    expect(env['LANG']).toBe('en_US.UTF-8')
    expect(spawn.mock.calls[0]?.[0]).toBe('/bin/zsh')
    expect(spawn.mock.calls[0]?.[1]).toEqual(['-ilc', 'env -0'])
  })

  it('falls back to the base env when the shell fails and keeps a UTF-8 LANG', async () => {
    const spawn = vi.fn((_f: string, _a: readonly string[], _o: unknown, cb: (err: Error | null, stdout: string) => void) => {
      cb(new Error('boom'), '')
      return undefined as never
    })
    const env = await resolveShellEnv({ platform: 'darwin', shell: '/bin/zsh', spawn: spawn as never, base: { LANG: 'ko_KR.UTF-8' } })
    expect(env['LANG']).toBe('ko_KR.UTF-8')
    expect(env['TERM']).toBe('xterm-256color')
  })

  it('does not spawn a shell on windows', async () => {
    const spawn = vi.fn()
    const env = await resolveShellEnv({ platform: 'win32', shell: 'pwsh.exe', spawn: spawn as never, base: { Path: 'C:\\x' } })
    expect(spawn).not.toHaveBeenCalled()
    expect(env['Path']).toBe('C:\\x')
    expect(env['TERM']).toBe('xterm-256color')
  })
})
```

Add to `tests/unit/shared/ipc.test.ts`:
```ts
  it('pty contracts', () => {
    expect(contracts['pty.spawn'].request.safeParse({ cwd: null, cols: 80, rows: 24 }).success).toBe(true)
    expect(contracts['pty.spawn'].response.safeParse({ ok: true, value: { id: 'pty1', pid: 42, cwd: '/x' } }).success).toBe(true)
    expect(pushContracts['pty.data'].safeParse({ id: 'pty1', data: 'hi' }).success).toBe(true)
    expect(pushContracts['pty.exit'].safeParse({ id: 'pty1', exitCode: 0 }).success).toBe(true)
  })
```

- [x] **Step 2: Run to verify failure** — `pnpm vitest run tests/unit/main/flowControl.test.ts tests/unit/main/env.test.ts tests/unit/shared/ipc.test.ts` → FAIL.

- [x] **Step 3: Implement**

`src/main/pty/flowControl.ts`:
```ts
export type FlowLimits = { readonly pauseAbove: number; readonly resumeBelow: number }

export type FlowControl = {
  readonly sent: (bytes: number) => 'pause' | null
  readonly acked: (bytes: number) => 'resume' | null
  readonly unacked: () => number
  readonly paused: () => boolean
}

const defaults: FlowLimits = { pauseAbove: 1_048_576, resumeBelow: 262_144 }

export const createFlowControl = (limits: FlowLimits = defaults): FlowControl => {
  let unacked = 0
  let paused = false

  return {
    sent: (bytes) => {
      unacked += bytes
      if (!paused && unacked > limits.pauseAbove) {
        paused = true
        return 'pause'
      }
      return null
    },
    acked: (bytes) => {
      unacked = Math.max(0, unacked - bytes)
      if (paused && unacked < limits.resumeBelow) {
        paused = false
        return 'resume'
      }
      return null
    },
    unacked: () => unacked,
    paused: () => paused,
  }
}
```

`src/main/pty/env.ts`:
```ts
import type { execFile } from 'node:child_process'

type ExecFile = typeof execFile

type Options = {
  readonly platform: NodeJS.Platform
  readonly shell: string
  readonly spawn: ExecFile
  readonly base?: Record<string, string | undefined>
  readonly timeoutMs?: number
}

export const parseEnvNul = (output: string): Record<string, string> =>
  output
    .split('\0')
    .filter((entry) => entry.includes('='))
    .reduce<Record<string, string>>((acc, entry) => {
      const index = entry.indexOf('=')
      return { ...acc, [entry.slice(0, index)]: entry.slice(index + 1) }
    }, {})

const clean = (env: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((kv): kv is [string, string] => typeof kv[1] === 'string'))

const withTerminalDefaults = (env: Record<string, string>): Record<string, string> => ({
  ...env,
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
  LANG: env['LANG']?.toUpperCase().includes('UTF-8') ? env['LANG'] : 'en_US.UTF-8',
})

const loginShellEnv = (shell: string, spawn: ExecFile, timeoutMs: number): Promise<Record<string, string> | null> =>
  new Promise((resolve) => {
    spawn(shell, ['-ilc', 'env -0'], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      resolve(error ? null : parseEnvNul(String(stdout)))
    })
  })

export const resolveShellEnv = async ({ platform, shell, spawn, base = process.env, timeoutMs = 3000 }: Options): Promise<Record<string, string>> => {
  const baseEnv = clean(base)
  if (platform === 'win32') return withTerminalDefaults(baseEnv)

  const fromShell = await loginShellEnv(shell, spawn, timeoutMs)
  return withTerminalDefaults(fromShell ? { ...baseEnv, ...fromShell } : baseEnv)
}

export const defaultShell = (platform: NodeJS.Platform, env: Record<string, string | undefined> = process.env): string => {
  if (platform === 'win32') return 'powershell.exe'
  return env['SHELL'] ?? (platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
}
```

`src/main/pty/manager.ts`:
```ts
import * as pty from 'node-pty'
import type { PushChannel, PushPayload } from '@shared/ipc'
import { type FlowControl, createFlowControl } from './flowControl'

type Push = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

type Deps = { readonly push: Push; readonly env: Record<string, string>; readonly shell: string; readonly stallMs?: number }

type Entry = { readonly proc: pty.IPty; readonly flow: FlowControl; alive: boolean; stall: NodeJS.Timeout | null }

export type SpawnOptions = { readonly cwd: string; readonly cols: number; readonly rows: number }

export type PtyManager = {
  readonly spawn: (options: SpawnOptions) => { id: string; pid: number }
  readonly write: (id: string, data: string) => void
  readonly resize: (id: string, cols: number, rows: number) => void
  readonly kill: (id: string) => void
  readonly ack: (id: string, bytes: number) => void
  readonly isAlive: (id: string) => boolean
  readonly disposeAll: () => void
}

export const createPtyManager = ({ push, env, shell, stallMs = 5000 }: Deps): PtyManager => {
  let entries: Record<string, Entry> = {}
  let counter = 0

  const clearStall = (entry: Entry): void => {
    if (entry.stall) clearTimeout(entry.stall)
    entry.stall = null
  }

  const pause = (id: string, entry: Entry): void => {
    entry.proc.pause()
    entry.stall = setTimeout(() => {
      entry.proc.resume()
      entry.stall = null
    }, stallMs)
    void id
  }

  const spawn = ({ cwd, cols, rows }: SpawnOptions): { id: string; pid: number } => {
    const id = `pty${(counter += 1)}`
    const proc = pty.spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd, env })
    const entry: Entry = { proc, flow: createFlowControl(), alive: true, stall: null }
    entries = { ...entries, [id]: entry }

    proc.onData((data) => {
      push('pty.data', { id, data })
      if (entry.flow.sent(Buffer.byteLength(data, 'utf8')) === 'pause') pause(id, entry)
    })
    proc.onExit(({ exitCode }) => {
      entry.alive = false
      clearStall(entry)
      push('pty.exit', { id, exitCode })
    })

    return { id, pid: proc.pid }
  }

  return {
    spawn,
    write: (id, data) => entries[id]?.proc.write(data),
    resize: (id, cols, rows) => {
      const entry = entries[id]
      if (entry?.alive && cols > 0 && rows > 0) entry.proc.resize(cols, rows)
    },
    kill: (id) => {
      const entry = entries[id]
      if (!entry) return
      clearStall(entry)
      if (entry.alive) entry.proc.kill()
      const { [id]: _dropped, ...rest } = entries
      entries = rest
    },
    ack: (id, bytes) => {
      const entry = entries[id]
      if (!entry) return
      if (entry.flow.acked(bytes) === 'resume') {
        clearStall(entry)
        entry.proc.resume()
      }
    },
    isAlive: (id) => entries[id]?.alive ?? false,
    disposeAll: () => {
      Object.values(entries).forEach((entry) => {
        clearStall(entry)
        if (entry.alive) entry.proc.kill()
      })
      entries = {}
    },
  }
}
```

Channels: add `ptySpawn: 'pty.spawn'`, `ptyWrite: 'pty.write'`, `ptyResize: 'pty.resize'`, `ptyKill: 'pty.kill'`, `ptyAck: 'pty.ack'` (in `sendChannels`), `ptyData: 'pty.data'`, `ptyExit: 'pty.exit'` (in `pushChannels`).

`src/shared/ipc.ts` contracts:
```ts
  'pty.spawn': { request: z.object({ cwd: z.string().nullable(), cols: z.number().int().positive(), rows: z.number().int().positive() }), response: ipcResult(z.object({ id: z.string(), pid: z.number(), cwd: z.string() }), UnexpectedError) },
  'pty.write': { request: z.object({ id: z.string(), data: z.string() }), response: ipcResult(z.literal(true), UnexpectedError) },
  'pty.resize': { request: z.object({ id: z.string(), cols: z.number().int().positive(), rows: z.number().int().positive() }), response: ipcResult(z.literal(true), UnexpectedError) },
  'pty.kill': { request: z.object({ id: z.string() }), response: ipcResult(z.literal(true), UnexpectedError) },
  'pty.isAlive': { request: z.object({ id: z.string() }), response: ipcResult(z.boolean(), UnexpectedError) },
// push:
  'pty.data': z.object({ id: z.string(), data: z.string() }),
  'pty.exit': z.object({ id: z.string(), exitCode: z.number() }),
```
Add `ptyIsAlive: 'pty.isAlive'` to channels. `pty.ack` is a send channel handled with `ipcMain.on` in the manager registration: `registerPtyChannels(manager)` validating `{ id, bytes }`.

Handlers: `HandlerDeps.pty: PtyManager`, `HandlerDeps.home: string`:
```ts
  handle('pty.spawn', async ({ cwd, cols, rows }) => {
    const dir = cwd && existsSync(cwd) ? cwd : home
    const { id, pid } = pty.spawn({ cwd: dir, cols, rows })
    return ok({ id, pid, cwd: dir })
  })
  handle('pty.write', async ({ id, data }) => { pty.write(id, data); return ok(true as const) })
  handle('pty.resize', async ({ id, cols, rows }) => { pty.resize(id, cols, rows); return ok(true as const) })
  handle('pty.kill', async ({ id }) => { pty.kill(id); return ok(true as const) })
  handle('pty.isAlive', async ({ id }) => ok(pty.isAlive(id)))
```
`index.ts`: `const shell = defaultShell(process.platform); const env = await resolveShellEnv({ platform: process.platform, shell, spawn: execFile }); const ptyManager = createPtyManager({ push: pushToAll, env, shell }); registerPtyAck(ptyManager)`; `app.on('before-quit', () => ptyManager.disposeAll())`. Log the resolved `PATH` length at info level.

- [x] **Step 4: Run** — `pnpm vitest run tests/unit && pnpm typecheck && pnpm build && pnpm exec playwright test tests/e2e/smoke.spec.ts` → PASS.

- [x] **Step 5: Commit** — `feat(pty): pty manager with login-shell env, ack-based flow control, and ipc contracts`

---

### Task 2: Terminal tabs in the workspace, xterm host, keymap allow-list

**Files:**
- Create: `src/renderer/src/terminal/registry.ts`, `src/renderer/src/terminal/theme.ts`, `src/renderer/src/ui/terminal/TerminalHost.tsx`
- Modify: `src/renderer/src/app/workspace.ts`, `src/renderer/src/app/context.ts`, `src/renderer/src/app/useKeymap.ts`, `src/renderer/src/app/registerCommands.ts`, `src/renderer/src/keymap/defaults.ts`, `src/renderer/src/ui/layout/PaneView.tsx`, `src/renderer/src/ui/tabs/TabStrip.tsx`, `src/renderer/src/theme/themes.ts` (export palette for xterm), `src/renderer/src/testHooks.ts`, `src/renderer/src/style.css`, `src/renderer/src/main.tsx` (import xterm css), `src/main/menu.ts`
- Test: `tests/e2e/terminal.spec.ts`

**Interfaces:**
- `Tab = { id; kind: 'buffer'; bufferId } | { id; kind: 'terminal'; ptyId: string }`.
- Workspace: `terminals: Record<ptyId, TerminalMeta>` in store where `TerminalMeta = { id: string; title: string; alive: boolean; exitCode: number | null; cwd: string }`; actions `newTerminal(): Promise<void>` (spawns with cwd = dirname of active buffer path, or null; cols/rows 80×24 then resized by host), `restartTerminal(ptyId)`, `sendToTerminal(text: string)` (targets the active terminal tab if any, else the most recently created live terminal, else spawns one), `terminalFocused: boolean` in state + `setTerminalFocus(paneId, focused)`; `closeTab` on a live terminal asks `confirmClose(title)` (reuse `dialog.confirmClose`; 'save' is treated like 'dontSave').
- Registry: `createTerminalRegistry(deps: { onInput(id, data); onResize(id, cols, rows); onAck(id, bytes); openPath(path, line?, col?) })` → `{ create(id, options: { theme: ITheme; fontFamily: string; fontSize: number }): TerminalEntry; get(id); dispose(id); write(id, data); setTheme(theme); setFont(fontFamily, fontSize) }` where `TerminalEntry = { term: Terminal; element: HTMLDivElement; fit: FitAddon }`. `write` calls `term.write(data, () => onAck(id, Buffer.byteLength))` — in the renderer use `new TextEncoder().encode(data).length`.
- `xtermTheme(theme: Theme): ITheme` — from the theme's palette (export `palette` on `Theme`).
- `TerminalHost` props `{ ws; leaf }`: for the active terminal tab, appends `entry.element` into its container, calls `fit.fit()` on mount and on `ResizeObserver`, focuses the terminal when the pane is focused, shows an overlay `[exited N] Restart` when `alive === false`.
- Keymap: `installKeymap` gets `isTerminalFocused: () => boolean`; when true and the resolved command is not allowed (`palette.`, `tab.`, `view.`, `terminal.`, `file.new`), treat as `none`.
- Commands: `terminal.new` (`ctrl+\``), `terminal.sendSelection` (`mod+alt+enter`, `when: editorFocus && hasSelection`), `terminal.sendPath` (`when: hasBuffer`), `terminal.sendAtPath` (`when: hasBuffer`), `terminal.restart` (`when: terminalFocus`).
- Test hooks: `terminals(): { id; title; alive; exitCode }[]`, `terminalText(): string` (visible buffer lines of the active terminal, trimmed, joined by `\n`), `terminalFocus(): void`.

- [x] **Step 1: Write the failing E2E**

`tests/e2e/terminal.spec.ts`:
```ts
import { test, expect, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { launchApp } from './launch'

const fixture = resolve('tests/e2e/fixtures/ime.ts')
const text = (page: Page) => page.evaluate(() => window.__moruTest!.terminalText())
const tabs = (page: Page) => page.evaluate(() => window.__moruTest!.tabs())

test.skip(process.platform === 'win32', 'shell commands below are POSIX')

test('terminal.new opens a shell tab that echoes output and keeps its buffer across tab switches', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await expect.poll(async () => (await tabs(page))[0]?.tabs.map((t) => t.title)).toEqual(['ime.ts', 'Terminal 1'])
  await expect(page.locator('.xterm')).toHaveCount(1)

  await page.evaluate(() => window.__moruTest!.terminalFocus())
  await page.keyboard.type('echo moru-term-ok\n')
  await expect.poll(() => text(page), { timeout: 10_000 }).toContain('moru-term-ok')

  await page.evaluate(() => window.__moruTest!.runCommand('tab.select', 1))
  await expect.poll(() => page.evaluate(() => window.__moruTest!.doc())).toContain('const foo')
  await page.evaluate(() => window.__moruTest!.runCommand('tab.select', 2))
  await expect.poll(() => text(page)).toContain('moru-term-ok')

  await app.close()
})

test('reserved keys reach the app while other keys reach the shell', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await page.evaluate(() => window.__moruTest!.terminalFocus())

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+/' : 'Control+/')
  await page.keyboard.type('x\n')
  await expect.poll(() => text(page), { timeout: 10_000 }).toContain('x')
  await page.evaluate(() => window.__moruTest!.runCommand('tab.select', 1))
  expect(await page.evaluate(() => window.__moruTest!.doc())).not.toContain('//')

  await page.evaluate(() => window.__moruTest!.runCommand('tab.select', 2))
  await page.evaluate(() => window.__moruTest!.terminalFocus())
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+p' : 'Control+Shift+p')
  await expect(page.getByTestId('palette')).toBeVisible()
  await page.keyboard.press('Escape')
  await app.close()
})

test('send selection and @path to the terminal', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await page.evaluate(() => window.__moruTest!.focus())
  await page.evaluate(() => window.__moruTest!.setSelection(6, 14))
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.sendSelection'))
  await expect.poll(async () => (await tabs(page))[0]?.tabs.length).toBe(2)
  await expect.poll(() => text(page), { timeout: 10_000 }).toContain('greeting')

  await page.evaluate(() => window.__moruTest!.runCommand('tab.select', 1))
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.sendAtPath'))
  await expect.poll(() => text(page), { timeout: 10_000 }).toContain('@')
  await expect.poll(() => text(page)).toContain('ime.ts')
  await app.close()
})

test('exited shell shows an overlay and can be restarted', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await page.evaluate(() => window.__moruTest!.terminalFocus())
  await page.keyboard.type('exit 3\n')
  await expect(page.getByTestId('terminal-exit')).toContainText('exited 3', { timeout: 10_000 })
  await expect.poll(async () => (await page.evaluate(() => window.__moruTest!.terminals()))[0]?.alive).toBe(false)

  await page.getByTestId('terminal-restart').click()
  await expect(page.getByTestId('terminal-exit')).toHaveCount(0)
  await page.evaluate(() => window.__moruTest!.terminalFocus())
  await page.keyboard.type('echo back-again\n')
  await expect.poll(() => text(page), { timeout: 10_000 }).toContain('back-again')
  await app.close()
})

test('closing a live terminal asks for confirmation', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture, MORU_TEST_CONFIRM: 'cancel' })
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await page.evaluate(() => window.__moruTest!.runCommand('tab.close'))
  await page.waitForTimeout(200)
  expect((await tabs(page))[0]?.tabs.length).toBe(2)
  await app.close()
})

test('[info] Korean composition inside the terminal reaches the shell', async () => {
  const { app, page } = await launchApp({ MORU_TEST_OPEN: fixture })
  await page.evaluate(() => window.__moruTest!.runCommand('terminal.new'))
  await page.evaluate(() => window.__moruTest!.terminalFocus())
  await page.keyboard.type('cat\n')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.insertText', { text: '한' })
  await page.keyboard.press('Enter')
  await expect.poll(() => text(page), { timeout: 10_000 }).toMatch(/한\s*\n\s*한/)
  await app.close()
})
```

Test hook additions: `setSelection(from, to)`.

- [x] **Step 2: Run to verify failure** — `pnpm add @xterm/xterm@6.0.0 @xterm/addon-webgl@0.19.0 @xterm/addon-fit@0.11.0 @xterm/addon-unicode11@0.9.0 @xterm/addon-web-links@0.12.0 @xterm/addon-search@0.16.0 && pnpm build && pnpm exec playwright test tests/e2e/terminal.spec.ts` → FAIL.

- [x] **Step 3: Implement**

`src/renderer/src/terminal/theme.ts`:
```ts
import type { ITheme } from '@xterm/xterm'
import type { Theme } from '../theme/themes'

export const xtermTheme = (theme: Theme): ITheme => ({
  background: theme.palette.bg,
  foreground: theme.palette.fg,
  cursor: theme.palette.cursor,
  selectionBackground: theme.palette.selection,
  black: theme.dark ? '#1e2227' : '#24292f',
  red: '#ec5f66',
  green: '#99c794',
  yellow: '#fac863',
  blue: '#6699cc',
  magenta: '#c695c6',
  cyan: '#5fb4b4',
  white: theme.dark ? '#d5dae0' : '#57606a',
  brightBlack: theme.dark ? '#5c6773' : '#8c959f',
  brightRed: '#f97b58',
  brightGreen: '#a9d69a',
  brightYellow: '#f9ae58',
  brightBlue: '#7ea8d8',
  brightMagenta: '#d3a6d3',
  brightCyan: '#7ac4c4',
  brightWhite: theme.dark ? '#ffffff' : '#24292f',
})
```
(`Theme` gains `palette: Palette` in `themes.ts`; `Palette` is exported.)

`src/renderer/src/terminal/registry.ts`:
```ts
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type ITheme } from '@xterm/xterm'
import { D } from '@mobily/ts-belt'
import { filePathLinkProvider } from './links'

export type TerminalEntry = { readonly term: Terminal; readonly element: HTMLDivElement; readonly fit: FitAddon }

export type TerminalOptions = { readonly theme: ITheme; readonly fontFamily: string; readonly fontSize: number }

type Deps = {
  readonly onInput: (id: string, data: string) => void
  readonly onResize: (id: string, cols: number, rows: number) => void
  readonly onAck: (id: string, bytes: number) => void
  readonly openPath: (path: string, line?: number, col?: number) => void
  readonly openUrl: (url: string) => void
}

export type TerminalRegistry = {
  readonly create: (id: string, options: TerminalOptions) => TerminalEntry
  readonly get: (id: string) => TerminalEntry | null
  readonly write: (id: string, data: string) => void
  readonly dispose: (id: string) => void
  readonly setTheme: (theme: ITheme) => void
  readonly setFont: (fontFamily: string, fontSize: number) => void
}

const encoder = new TextEncoder()

const tryWebgl = (term: Terminal): void => {
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose())
    term.loadAddon(webgl)
  } catch {
    // canvas/DOM renderer stays active when WebGL is unavailable
  }
}

export const createTerminalRegistry = (deps: Deps): TerminalRegistry => {
  let entries: Record<string, TerminalEntry> = {}

  const create = (id: string, options: TerminalOptions): TerminalEntry => {
    const element = document.createElement('div')
    element.className = 'terminal-surface'

    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      convertEol: false,
      scrollback: 10_000,
      fontFamily: options.fontFamily,
      fontSize: options.fontSize,
      theme: options.theme,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.loadAddon(new SearchAddon())
    term.loadAddon(new WebLinksAddon((_event, uri) => deps.openUrl(uri)))
    term.registerLinkProvider(filePathLinkProvider(term, (path, line, col) => deps.openPath(path, line, col)))
    term.open(element)
    tryWebgl(term)

    term.onData((data) => deps.onInput(id, data))
    term.onResize(({ cols, rows }) => deps.onResize(id, cols, rows))

    const entry = { term, element, fit }
    entries = D.set(entries, id, entry)
    return entry
  }

  return {
    create,
    get: (id) => entries[id] ?? null,
    write: (id, data) => {
      const entry = entries[id]
      if (entry) entry.term.write(data, () => deps.onAck(id, encoder.encode(data).length))
    },
    dispose: (id) => {
      entries[id]?.term.dispose()
      entries[id]?.element.remove()
      entries = D.deleteKey(entries, id)
    },
    setTheme: (theme) => Object.values(entries).forEach((e) => (e.term.options.theme = theme)),
    setFont: (fontFamily, fontSize) =>
      Object.values(entries).forEach((e) => {
        e.term.options.fontFamily = fontFamily
        e.term.options.fontSize = fontSize
        e.fit.fit()
      }),
  }
}
```

`src/renderer/src/terminal/links.ts` (Task 3 implements the provider fully; for this task create it with the path regex and provider skeleton — see Task 3 for the code; both tasks land in one build).

Workspace changes:
- `Tab` union; `newTerminal`, `restartTerminal`, `sendToTerminal`, `terminals` store, `terminalFocused`, `setTerminalFocus`. `newTerminal` flow: `invoke('pty.spawn', { cwd, cols: 80, rows: 24 })` → on Ok add tab `{ kind: 'terminal', ptyId }`, `terminals[id] = { id, title: \`Terminal ${n}\`, alive: true, exitCode: null, cwd }`. Data/exit pushes are subscribed once in the workspace constructor: `on('pty.data', ({ id, data }) => registry.write(id, data))`, `on('pty.exit', ({ id, exitCode }) => setState('terminals', id, { alive: false, exitCode }))`.
- `restartTerminal(ptyId)`: spawn a new pty with the same cwd, dispose the old registry entry, replace the tab's `ptyId` (tabs are keyed by tab id so the tree is untouched), create a new registry entry.
- `sendToTerminal(text)`: choose target → `invoke('pty.write', { id, data: text })`; if no terminal exists, `await newTerminal()` first and wait 300 ms for the shell prompt (`setTimeout`) before writing.
- The registry is created inside the workspace (`deps.registry` factory receives callbacks): `onInput → pty.write`, `onResize → pty.resize`, `onAck → window.moru.send('pty.ack', …)`, `openPath → openFile then setCursor line/col`, `openUrl → window.moru.send? ` → use `invoke('shell.openExternal', url)` (add a tiny contract) — or simpler: `window.open(url)` which our `setWindowOpenHandler` in main routes to `shell.openExternal`. Use `window.open`.
- `closeTab` for terminal tabs: if `terminals[ptyId].alive` → `confirmClose(title)`; on anything but `cancel` → `invoke('pty.kill')`, `registry.dispose`, drop tab and `terminals[id]`.
- `whenContext`: `terminalFocus: ws.state.terminalFocused`, `hasTerminal: any live terminal`. `editorFocus` must be false while the terminal is focused (set in `setTerminalFocus`).

`useKeymap.ts`: add `isTerminalFocused` from context: if `ctx['terminalFocus'] === true` and `resolution.kind === 'run'` and not `allowedInTerminal(resolution.binding.command)` → treat as none (do not preventDefault).

`registerCommands.ts`:
```ts
{ id: 'terminal.new', title: 'Terminal: New Terminal', run: () => ws.newTerminal() },
{ id: 'terminal.restart', title: 'Terminal: Restart', when: 'terminalFocus', run: () => ws.restartActiveTerminal() },
{ id: 'terminal.sendSelection', title: 'Terminal: Send Selection', when: 'editorFocus && hasSelection', run: () => { const v = ws.activeView(); if (v) ws.sendToTerminal(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)) } },
{ id: 'terminal.sendPath', title: 'Terminal: Send File Path', when: 'hasBuffer', run: () => { const p = ws.activeBuffer()?.meta?.path; if (p) ws.sendToTerminal(shellQuote(p)) } },
{ id: 'terminal.sendAtPath', title: 'Terminal: Send @path', when: 'hasBuffer', run: () => { const p = ws.activeBuffer()?.meta?.path; if (p) ws.sendToTerminal(`@${ws.relativePath(p)} `) } },
```
`shellQuote(p)` = `'${p.replace(/'/g, "'\\''")}'`; `ws.relativePath(p)` = relative to the active terminal's cwd when `p` starts with it, else `p`.

Defaults: `{ keys: 'ctrl+`', command: 'terminal.new' }`, `editor('mod+alt+enter', 'terminal.sendSelection')` (its `when` is the command's), `{ keys: 'mod+alt+shift+enter', command: 'terminal.sendAtPath' }`.

`TerminalHost.tsx`:
```tsx
import { Show, createEffect, on, onCleanup, onMount } from 'solid-js'
import type { Workspace } from '../../app/workspace'
import type { PaneLeaf } from '../layout/paneTree'

export const TerminalHost = (props: { ws: Workspace; leaf: () => PaneLeaf; ptyId: () => string }) => {
  let host!: HTMLDivElement

  const meta = () => props.ws.state.terminals[props.ptyId()]

  onMount(() => {
    const observer = new ResizeObserver(() => props.ws.terminalRegistry.get(props.ptyId())?.fit.fit())
    observer.observe(host)

    createEffect(
      on(props.ptyId, (id) => {
        const entry = props.ws.terminalRegistry.get(id)
        if (!entry) return
        host.replaceChildren(entry.element)
        requestAnimationFrame(() => entry.fit.fit())
      }),
    )

    onCleanup(() => observer.disconnect())
  })

  return (
    <div
      class="terminal-host"
      ref={host}
      onFocusIn={() => props.ws.setTerminalFocus(props.leaf().id, true)}
      onFocusOut={() => props.ws.setTerminalFocus(props.leaf().id, false)}
      onMouseDown={() => props.ws.focusPane(props.leaf().id)}
    >
      <Show when={meta() && !meta()!.alive}>
        <div class="terminal-exit" data-testid="terminal-exit">
          <span>[exited {meta()!.exitCode}]</span>
          <button data-testid="terminal-restart" onClick={() => void props.ws.restartTerminal(props.ptyId())}>Restart</button>
        </div>
      </Show>
    </div>
  )
}
```
`host.replaceChildren(entry.element)` must not remove the exit overlay — render the overlay as a sibling: wrap `host` (surface slot) and the overlay in an outer div; the effect targets the inner slot only.

`PaneView.tsx` `LeafView`: pick the active tab's kind: `buffer` → `<EditorHost>`, `terminal` → `<TerminalHost ptyId>`; when no active tab → `<EditorHost>` (empty). Keep `EditorHost` mounted (hidden with `display: none`) while a terminal tab is active so the `EditorView` and its registration survive; simplest: render both, toggle `hidden` on the editor host wrapper via a class.

`TabStrip.tsx`: title from `tab.kind === 'terminal' ? ws.state.terminals[tab.ptyId]?.title : buffer meta`; dirty dot only for buffers.

`main.tsx`: `import '@xterm/xterm/css/xterm.css'`.

`style.css`: `.terminal-host { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; background: var(--bg) } .terminal-surface { position: absolute; inset: 0; padding: 4px } .terminal-exit { position: absolute; inset: auto 0 0 0; display: flex; gap: 8px; align-items: center; padding: 6px 10px; background: var(--bar); border-top: 1px solid var(--border) } .editor-host.hidden { display: none }`.

Settings effect in `App.tsx`: `ws.terminalRegistry.setTheme(xtermTheme(themeById(s.theme)))` and `setFont(cssFontFamily(s.editor.fontFamily), s.editor.fontSize)` (export `cssFontFamily` from `editorConfig.ts`).

Menu: View → `command('New Terminal', 'terminal.new')`.

Test hooks: `terminals`, `terminalText` (`const t = entry.term; lines = for y in 0..t.buffer.active.length: t.buffer.active.getLine(y)?.translateToString(true)`; join and trim trailing blank lines), `terminalFocus` (`entry.term.focus()`), `setSelection(from, to)`.

- [x] **Step 4: Run** — `pnpm typecheck && pnpm test && pnpm build && pnpm exec playwright test` → PASS (the `[info]` IME test may fail on CI runners without a shell prompt; keep it and report).

- [x] **Step 5: Commit** — `feat(terminal): terminal tabs with xterm.js, reserved keys, send-to-terminal, exit overlay`

---

### Task 3: File-path links in terminal output

**Files:**
- Create: `src/renderer/src/terminal/links.ts`
- Test: `tests/unit/renderer/links.test.ts`

**Interfaces:**
- `parsePathRefs(line: string): { text: string; start: number; end: number; path: string; line?: number; col?: number }[]` — matches `path/to/file.ext`, `./rel/file.ts:12`, `/abs/file.py:3:7`, `C:\dir\file.txt:5`; excludes URLs (`://`) and bare words without `/`, `\` or an extension.
- `filePathLinkProvider(term: Terminal, onOpen: (path, line?, col?) => void): ILinkProvider` — reads the buffer line, maps matches to `ILink` ranges (1-based x, `y = bufferLineNumber`).

- [x] **Step 1: Write the failing test**

`tests/unit/renderer/links.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parsePathRefs } from '@renderer/terminal/links'

describe('parsePathRefs', () => {
  it('finds relative and absolute paths with optional line and column', () => {
    const refs = parsePathRefs('error in src/app/workspace.ts:120:7 and ./README.md and /tmp/x.log:3')
    expect(refs.map((r) => [r.path, r.line, r.col])).toEqual([
      ['src/app/workspace.ts', 120, 7],
      ['./README.md', undefined, undefined],
      ['/tmp/x.log', 3, undefined],
    ])
    expect(refs[0]).toMatchObject({ start: 9, end: 34 })
  })

  it('handles windows paths and ignores urls', () => {
    const refs = parsePathRefs('see C:\\work\\a.txt:5 or https://example.com/x.ts')
    expect(refs.map((r) => r.path)).toEqual(['C:\\work\\a.txt'])
  })

  it('returns nothing for plain words', () => {
    expect(parsePathRefs('hello world 1.5 done')).toEqual([])
  })
})
```

- [x] **Step 2: Run to verify failure** → FAIL.

- [x] **Step 3: Implement**

`src/renderer/src/terminal/links.ts`:
```ts
import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'

export type PathRef = { readonly text: string; readonly start: number; readonly end: number; readonly path: string; readonly line?: number; readonly col?: number }

const pattern = /(?<![\w:/])((?:[A-Za-z]:\\|\.{1,2}[\\/]|~[\\/]|\/)?(?:[\w.-]+[\\/])*[\w.-]+\.[A-Za-z0-9]+)(?::(\d+))?(?::(\d+))?/g

const isUrlContext = (line: string, start: number): boolean => line.slice(Math.max(0, start - 8), start).includes('://')

const hasSeparatorOrExt = (path: string): boolean => /[\\/]/.test(path) || /\.[A-Za-z0-9]+$/.test(path)

export const parsePathRefs = (line: string): PathRef[] =>
  Array.from(line.matchAll(pattern)).flatMap((m) => {
    const start = m.index ?? 0
    const path = m[1] as string
    if (isUrlContext(line, start) || !hasSeparatorOrExt(path) || /^\d+\.\d+$/.test(path)) return []
    const text = m[0]
    const lineNo = m[2] ? Number(m[2]) : undefined
    const colNo = m[3] ? Number(m[3]) : undefined
    return [{ text, start, end: start + text.length, path, line: lineNo, col: colNo }]
  })

export const filePathLinkProvider = (term: Terminal, onOpen: (path: string, line?: number, col?: number) => void): ILinkProvider => ({
  provideLinks: (bufferLineNumber, callback) => {
    const bufferLine = term.buffer.active.getLine(bufferLineNumber - 1)
    if (!bufferLine) return callback(undefined)
    const text = bufferLine.translateToString(true)
    const links: ILink[] = parsePathRefs(text).map((ref) => ({
      text: ref.text,
      range: { start: { x: ref.start + 1, y: bufferLineNumber }, end: { x: ref.end, y: bufferLineNumber } },
      activate: () => onOpen(ref.path, ref.line, ref.col),
    }))
    callback(links.length > 0 ? links : undefined)
  },
})
```
The workspace's `openPath(path, line, col)` resolves relative paths against the terminal's `cwd` (`~` → home requires main; skip `~` resolution and log). After `openFile`, dispatch `selection: { anchor: doc.line(line).from + (col - 1) }` clamped.

- [x] **Step 4: Run** — unit PASS; `pnpm typecheck && pnpm build` PASS.

- [x] **Step 5: Commit** — `feat(terminal): clickable file:line:col links resolved against the terminal cwd`

---

### Task 4: Report

- [ ] Run `pnpm check`; write `docs/superpowers/reports/m2a-terminal.md` (table: pty env/flow unit · terminal e2e ×6 · links unit · regressions; findings; the "Claude Code 안에서 실행" acceptance is a manual item — record whether it was run and the observed behavior). Tick checkboxes. Commit `docs(m2a): add terminal report`.

## Self-Review Notes

- Spec §5.5 coverage: env/TERM/LANG (T1), cwd (T2 — active buffer dir until the sidebar/project root lands in M2b), 흐름 제어 (T1 + T2 ack), 종료 오버레이·재시작 (T2), 예약 키 (T2 allow-list), 한글 (T2 `[info]`), 경로 링크 (T3), 전송 3종 (T2). Session persistence of terminal cwd is M3.
- Type consistency: `Tab` union changes ripple to `TabStrip`, `EditorHost` (buffer tabs only), `workspace.tabForPath` (filter `kind === 'buffer'`), `testHooks.tabs()` (title from either meta) — all in T2.
- Test ids: `terminal-exit`, `terminal-restart`; hooks: `terminals`, `terminalText`, `terminalFocus`, `setSelection`.
