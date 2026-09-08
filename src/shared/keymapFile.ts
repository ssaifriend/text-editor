import { parse, type ParseError, printParseErrorCode } from 'jsonc-parser'
import { z } from 'zod'

export const UserBinding = z.object({
  keys: z.string().min(1),
  command: z.string().min(1),
  when: z.string().optional(),
  args: z.unknown().optional(),
})
export type UserBinding = z.infer<typeof UserBinding>

export const KeymapFile = z.array(UserBinding)

export const KeymapSnapshot = z.object({ bindings: KeymapFile, error: z.string().nullable() })
export type KeymapSnapshot = z.infer<typeof KeymapSnapshot>

export type ParsedKeymap = { ok: true; bindings: UserBinding[] } | { ok: false; message: string }

export const parseKeymapText = (text: string): ParsedKeymap => {
  if (text.trim() === '') return { ok: true, bindings: [] }

  const errors: ParseError[] = []
  const data: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    return { ok: false, message: errors.map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`).join('; ') }
  }

  const parsed = KeymapFile.safeParse(data)
  return parsed.success
    ? { ok: true, bindings: parsed.data }
    : { ok: false, message: parsed.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ') }
}
