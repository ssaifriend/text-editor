import { describe, it, expect, vi } from 'vitest'
import { parseEnvNul, resolveShellEnv } from '../../../src/main/pty/env'

type Cb = (err: Error | null, stdout: string) => void

describe('parseEnvNul', () => {
  it('splits on NUL and keeps values containing =', () => {
    expect(parseEnvNul('PATH=/a:/b\0FOO=x=y\0BAD\0')).toEqual({ PATH: '/a:/b', FOO: 'x=y' })
  })
})

describe('resolveShellEnv', () => {
  it('merges the login shell env over the base env and forces terminal variables', async () => {
    const spawn = vi.fn((_file: string, _args: readonly string[], _opts: unknown, cb: Cb) => {
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
    const spawn = vi.fn((_f: string, _a: readonly string[], _o: unknown, cb: Cb) => {
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
