import { execFile } from 'node:child_process'
import { sep } from 'node:path'

const toPosix = (p: string): string => (sep === '\\' ? p.split(sep).join('/') : p)

export const listFiles = (
  root: string,
  rgPath: string,
  cap = 200_000,
): Promise<{ files: string[]; truncated: boolean }> =>
  new Promise((resolve, reject) => {
    const args = ['--files', '--hidden', '--glob', '!.git/**', '--glob', '!node_modules/**', '-0']
    execFile(rgPath, args, { cwd: root, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      if (error && (error as { code?: number | string }).code !== 1) return reject(error)
      const all = String(stdout)
        .split('\0')
        .filter((p) => p.length > 0)
        .map((p) => toPosix(p).normalize('NFC'))
        .sort()
      resolve({ files: all.slice(0, cap), truncated: all.length > cap })
    })
  })
