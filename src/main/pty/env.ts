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
    spawn(
      shell,
      ['-ilc', 'env -0'],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => resolve(error ? null : parseEnvNul(String(stdout))),
    )
  })

export const resolveShellEnv = async ({
  platform,
  shell,
  spawn,
  base = process.env,
  timeoutMs = 3000,
}: Options): Promise<Record<string, string>> => {
  const baseEnv = clean(base)
  if (platform === 'win32') return withTerminalDefaults(baseEnv)

  const fromShell = await loginShellEnv(shell, spawn, timeoutMs)
  return withTerminalDefaults(fromShell ? { ...baseEnv, ...fromShell } : baseEnv)
}

export const defaultShell = (platform: NodeJS.Platform, env: Record<string, string | undefined> = process.env): string => {
  if (platform === 'win32') return 'powershell.exe'
  return env['SHELL'] ?? (platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
}
