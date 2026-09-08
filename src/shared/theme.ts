import { z } from 'zod'

const color = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'expected a hex colour like #1e2227')

export const ThemePalette = z.object({
  bg: color,
  fg: color,
  bar: color,
  border: color,
  selection: color,
  cursor: color,
  activeLine: color,
  gutter: color,
  keyword: color,
  string: color,
  comment: color,
  number: color,
  fn: color,
  type: color,
  variable: color,
  operator: color,
  heading: color,
  link: color,
})
export type ThemePalette = z.infer<typeof ThemePalette>

export const UserTheme = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'theme id: lowercase letters, digits and dashes'),
  dark: z.boolean(),
  palette: ThemePalette,
})
export type UserTheme = z.infer<typeof UserTheme>

export const ThemesSnapshot = z.object({ themes: z.array(UserTheme), errors: z.array(z.object({ file: z.string(), message: z.string() })) })
export type ThemesSnapshot = z.infer<typeof ThemesSnapshot>

export const parseUserTheme = (text: string): { ok: true; theme: UserTheme } | { ok: false; message: string } => {
  try {
    const parsed = UserTheme.safeParse(JSON.parse(text))
    return parsed.success ? { ok: true, theme: parsed.data } : { ok: false, message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
