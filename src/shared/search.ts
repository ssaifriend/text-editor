import { z } from 'zod'

export const SearchSpec = z.object({
  pattern: z.string(),
  regexp: z.boolean(),
  caseSensitive: z.boolean(),
  wholeWord: z.boolean(),
  include: z.string().default(''),
  exclude: z.string().default(''),
})
export type SearchSpec = z.infer<typeof SearchSpec>

export const SearchMatch = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  text: z.string(),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
})
export type SearchMatch = z.infer<typeof SearchMatch>

export const SearchBatch = z.object({ id: z.string(), matches: z.array(SearchMatch) })
export type SearchBatch = z.infer<typeof SearchBatch>

export const SearchDone = z.object({
  id: z.string(),
  files: z.number().int().nonnegative(),
  matches: z.number().int().nonnegative(),
  truncated: z.boolean(),
  error: z.string().nullable(),
})
export type SearchDone = z.infer<typeof SearchDone>

export const ReplacePlan = z.object({
  spec: SearchSpec,
  replacement: z.string(),
  preserveCase: z.boolean(),
  files: z.array(
    z.object({
      path: z.string(),
      hash: z.string(),
      lines: z.array(z.object({ line: z.number().int().positive(), skip: z.array(z.number().int().nonnegative()).default([]) })),
    }),
  ),
})
export type ReplacePlan = z.infer<typeof ReplacePlan>

export const ReplaceSkipReason = z.enum(['hashMismatch', 'readError', 'writeError', 'encodingLossy', 'notFound'])
export type ReplaceSkipReason = z.infer<typeof ReplaceSkipReason>

export const ReplaceReport = z.object({
  changed: z.array(z.object({ path: z.string(), matches: z.number().int().nonnegative() })),
  skipped: z.array(z.object({ path: z.string(), reason: ReplaceSkipReason })),
})
export type ReplaceReport = z.infer<typeof ReplaceReport>
