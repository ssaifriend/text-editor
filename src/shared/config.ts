import { parse, type ParseError, printParseErrorCode } from 'jsonc-parser'
import { z } from 'zod'
import { encodingNames } from './encoding'

export const EditorSettings = z.object({
  fontFamily: z
    .array(z.string())
    .default(['D2Coding', 'Sarasa Mono K', 'ui-monospace', 'Menlo', 'Consolas', 'monospace']),
  fontSize: z.number().int().min(6).max(72).default(13),
  tabSize: z.number().int().min(1).max(16).default(4),
  insertSpaces: z.boolean().default(true),
  wordWrap: z.boolean().default(false),
  wordBreak: z.enum(['normal', 'keep-all']).default('normal'),
  rulers: z.array(z.number().int().positive()).default([]),
  highlightWhitespace: z.boolean().default(false),
  lineNumbers: z.boolean().default(true),
})
export type EditorSettings = z.infer<typeof EditorSettings>

export const FilesSettings = z.object({
  autoSave: z.enum(['off', 'afterDelay']).default('off'),
  autoSaveDelayMs: z.number().int().min(100).default(1000),
  hotExit: z.boolean().default(true),
  trimTrailingWhitespace: z.boolean().default(false),
  insertFinalNewline: z.boolean().default(false),
  defaultEncoding: z.enum(encodingNames).default('utf8'),
  defaultEol: z.enum(['auto', 'lf', 'crlf']).default('auto'),
})
export type FilesSettings = z.infer<typeof FilesSettings>

export const SearchSettings = z.object({
  encoding: z.enum(['auto', ...encodingNames]).default('auto'),
  maxFileSizeMb: z.number().int().min(1).max(1024).default(10),
  exclude: z.array(z.string()).default([]),
})
export type SearchSettings = z.infer<typeof SearchSettings>

export const Settings = z.object({
  editor: EditorSettings.prefault({}),
  files: FilesSettings.prefault({}),
  search: SearchSettings.prefault({}),
  theme: z.string().default('moru-dark'),
  languages: z.record(z.string(), EditorSettings.partial()).default({}),
  log: z.object({ level: z.enum(['debug', 'info', 'warn', 'error']).default('info') }).prefault({}),
})
export type Settings = z.infer<typeof Settings>

export const defaultSettings: Settings = Settings.parse({})

export const ConfigSnapshot = z.object({ settings: Settings, error: z.string().nullable() })
export type ConfigSnapshot = z.infer<typeof ConfigSnapshot>

const describeParseErrors = (errors: ParseError[]): string =>
  errors.map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`).join('; ')

const describeIssues = (issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string =>
  issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ')

export type ParsedSettings = { ok: true; settings: Settings } | { ok: false; message: string }

export const parseSettingsText = (text: string): ParsedSettings => {
  if (text.trim() === '') return { ok: true, settings: defaultSettings }

  const errors: ParseError[] = []
  const data: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length > 0) return { ok: false, message: describeParseErrors(errors) }

  const parsed = Settings.safeParse(data ?? {})
  return parsed.success
    ? { ok: true, settings: parsed.data }
    : { ok: false, message: describeIssues(parsed.error.issues) }
}

export const resolveForLanguage = (settings: Settings, languageId: string): EditorSettings => ({
  ...settings.editor,
  ...(settings.languages[languageId] ?? {}),
})
