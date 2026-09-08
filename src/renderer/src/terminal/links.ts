import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'

export type PathRef = {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly path: string
  readonly line?: number
  readonly col?: number
}

const pattern =
  /(?<![\w:/])((?:[A-Za-z]:\\|\.{1,2}[\\/]|~[\\/]|\/)?(?:[\w.-]+[\\/])*[\w.-]+\.[A-Za-z0-9]+)(?::(\d+))?(?::(\d+))?/g

const isUrlContext = (line: string, start: number): boolean => {
  const tokenStart = line.lastIndexOf(' ', start) + 1
  const nextSpace = line.indexOf(' ', start)
  const token = line.slice(tokenStart, nextSpace === -1 ? line.length : nextSpace)
  return token.includes('://')
}

const hasSeparatorOrExt = (path: string): boolean => /[\\/]/.test(path) || /\.[A-Za-z0-9]+$/.test(path)

export const parsePathRefs = (line: string): PathRef[] =>
  Array.from(line.matchAll(pattern)).flatMap((m) => {
    const start = m.index ?? 0
    const path = m[1] as string
    if (isUrlContext(line, start) || !hasSeparatorOrExt(path) || /^\d+\.\d+$/.test(path)) return []

    const text = m[0]
    return [
      {
        text,
        start,
        end: start + text.length,
        path,
        line: m[2] ? Number(m[2]) : undefined,
        col: m[3] ? Number(m[3]) : undefined,
      },
    ]
  })

export const filePathLinkProvider = (
  term: Terminal,
  onOpen: (path: string, line?: number, col?: number) => void,
): ILinkProvider => ({
  provideLinks: (bufferLineNumber, callback) => {
    const bufferLine = term.buffer.active.getLine(bufferLineNumber - 1)
    if (!bufferLine) return callback(undefined)

    const links: ILink[] = parsePathRefs(bufferLine.translateToString(true)).map((ref) => ({
      text: ref.text,
      range: { start: { x: ref.start + 1, y: bufferLineNumber }, end: { x: ref.end, y: bufferLineNumber } },
      activate: () => onOpen(ref.path, ref.line, ref.col),
    }))
    callback(links.length > 0 ? links : undefined)
  },
})
