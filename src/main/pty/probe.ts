import * as pty from 'node-pty'

export type PtyProbeResult = { readonly output: string; readonly exitCode: number }

type ShellCommand = { readonly file: string; readonly args: readonly string[] }

const shellCommand = (): ShellCommand =>
  process.platform === 'win32'
    ? { file: 'cmd.exe', args: ['/c', 'echo moru-pty-ok'] }
    : { file: process.env['SHELL'] ?? '/bin/sh', args: ['-c', 'echo moru-pty-ok'] }

export const probePty = (): Promise<PtyProbeResult> =>
  new Promise((resolve, reject) => {
    const { file, args } = shellCommand()
    const child = pty.spawn(file, [...args], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    })

    const chunks: string[] = []
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('pty probe timed out after 5000ms'))
    }, 5000)

    child.onData((data) => chunks.push(data))
    child.onExit(({ exitCode }) => {
      clearTimeout(timer)
      resolve({ output: chunks.join(''), exitCode })
    })
  })
