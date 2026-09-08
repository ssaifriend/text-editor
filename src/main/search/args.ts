import type { SearchSpec } from '@shared/search'

export type RgOptions = { readonly encoding: string; readonly maxFileSizeMb: number; readonly exclude: readonly string[] }

const splitGlobs = (text: string): string[] =>
  text
    .split(',')
    .map((g) => g.trim())
    .filter((g) => g !== '')

export const rgArgs = (spec: SearchSpec, roots: readonly string[], opts: RgOptions): string[] => [
  '--json',
  '--hidden',
  '--glob',
  '!.git/**',
  ...opts.exclude.flatMap((g) => ['--glob', `!${g}`]),
  '--max-filesize',
  `${opts.maxFileSizeMb}M`,
  ...(opts.encoding === 'auto' ? [] : ['-E', opts.encoding]),
  ...(spec.caseSensitive ? [] : ['-i']),
  ...(spec.wholeWord ? ['-w'] : []),
  ...(spec.regexp ? [] : ['-F']),
  ...splitGlobs(spec.include).flatMap((g) => ['--glob', g]),
  ...splitGlobs(spec.exclude).flatMap((g) => ['--glob', `!${g}`]),
  '-e',
  spec.pattern,
  '--',
  ...roots,
]
