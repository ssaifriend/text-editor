import { css } from '@codemirror/lang-css'
import { go } from '@codemirror/lang-go'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import type { Extension } from '@codemirror/state'
import { A, D, O, S, pipe } from '@mobily/ts-belt'

export type Language = { readonly id: string; readonly name: string; readonly load: () => Extension }

export const plainLanguage: Language = { id: 'plain', name: 'Plain Text', load: () => [] }

export const languages: readonly Language[] = [
  plainLanguage,
  { id: 'typescript', name: 'TypeScript', load: () => javascript({ typescript: true }) },
  { id: 'tsx', name: 'TSX', load: () => javascript({ typescript: true, jsx: true }) },
  { id: 'javascript', name: 'JavaScript', load: () => javascript() },
  { id: 'jsx', name: 'JSX', load: () => javascript({ jsx: true }) },
  { id: 'json', name: 'JSON', load: () => json() },
  { id: 'markdown', name: 'Markdown', load: () => markdown({ base: markdownLanguage }) },
  { id: 'python', name: 'Python', load: () => python() },
  { id: 'rust', name: 'Rust', load: () => rust() },
  { id: 'go', name: 'Go', load: () => go() },
  { id: 'html', name: 'HTML', load: () => html() },
  { id: 'css', name: 'CSS', load: () => css() },
  { id: 'yaml', name: 'YAML', load: () => yaml() },
  { id: 'sql', name: 'SQL', load: () => sql() },
  { id: 'shell', name: 'Shell', load: () => StreamLanguage.define(shell) },
]

const byExtension: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  html: 'html',
  htm: 'html',
  css: 'css',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
}

const byFilename: Record<string, string> = {
  '.zshrc': 'shell',
  '.bashrc': 'shell',
  '.bash_profile': 'shell',
  '.profile': 'shell',
}

const lastSegment = (separator: string | RegExp) => (text: string): string =>
  pipe(text.split(separator), A.last, O.getWithDefault<string>(''))

export const basenameOf = (path: string): string => lastSegment(/[\\/]/)(path)

export const extensionOf = (path: string): string => pipe(path, basenameOf, lastSegment('.'), S.toLowerCase)

const languageIdFor = (path: string): string =>
  pipe(
    D.get(byFilename, basenameOf(path).toLowerCase()),
    O.match(
      (id) => id,
      () => pipe(D.get(byExtension, extensionOf(path)), O.getWithDefault<string>('plain')),
    ),
  )

export const languageById = (id: string): Language =>
  pipe(
    languages,
    A.find((l) => l.id === id),
    O.getWithDefault(plainLanguage),
  )

export const languageFor = (path: string): Language => languageById(languageIdFor(path))
