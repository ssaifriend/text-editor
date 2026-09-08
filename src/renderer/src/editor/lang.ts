import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import type { Extension } from '@codemirror/state'
import { A, D, O, S, pipe } from '@mobily/ts-belt'

const byExtension: Record<string, () => Extension> = {
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  mjs: () => javascript(),
  cjs: () => javascript(),
  json: () => json(),
  md: () => markdown(),
  markdown: () => markdown(),
}

const lastSegment = (separator: string) => (text: string): string =>
  pipe(text, S.split(separator), A.last, O.getWithDefault<string>(''))

export const extensionOf = (path: string): string =>
  pipe(path, lastSegment('/'), lastSegment('.'), S.toLowerCase)

export const languageFor = (path: string): Extension =>
  pipe(
    D.get(byExtension, extensionOf(path)),
    O.map((make) => make()),
    O.getWithDefault<Extension>([]),
  )
