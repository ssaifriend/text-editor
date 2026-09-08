import { type FSWatcher, watch } from 'node:fs'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { type ThemesSnapshot, type UserTheme, parseUserTheme } from '@shared/theme'

type Loaded = { kind: 'theme'; theme: UserTheme } | { kind: 'error'; error: { file: string; message: string } }

export type ThemesService = { readonly snapshot: () => ThemesSnapshot; readonly dispose: () => void }

const debounceMs = 100
const pollMs = 1000

const loadThemes = async (dir: string): Promise<ThemesSnapshot> => {
  let names: string[]
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort()
  } catch {
    return { themes: [], errors: [] }
  }
  const results: Loaded[] = await Promise.all(
    names.map(async (name): Promise<Loaded> => {
      const parsed = parseUserTheme(await readFile(join(dir, name), 'utf8'))
      return parsed.ok ? { kind: 'theme', theme: parsed.theme } : { kind: 'error', error: { file: name, message: parsed.message } }
    }),
  )
  return {
    themes: results.flatMap((r) => (r.kind === 'theme' ? [r.theme] : [])),
    errors: results.flatMap((r) => (r.kind === 'error' ? [r.error] : [])),
  }
}

const dirStamp = async (dir: string): Promise<string> => {
  try {
    const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort()
    const stats = await Promise.all(names.map((n) => stat(join(dir, n)).then((s) => `${n}:${s.mtimeMs}`, () => n)))
    return stats.join('|')
  } catch {
    return ''
  }
}

export const createThemesService = async (userData: string, onChange: (snapshot: ThemesSnapshot) => void): Promise<ThemesService> => {
  const dir = join(userData, 'themes')
  await mkdir(dir, { recursive: true })

  let current = await loadThemes(dir)
  let timer: NodeJS.Timeout | null = null
  const reload = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      current = await loadThemes(dir)
      onChange(current)
    }, debounceMs)
  }

  const watcher: FSWatcher = watch(dir, () => reload())
  let lastStamp = await dirStamp(dir)
  const poll = setInterval(async () => {
    const stamp = await dirStamp(dir)
    if (stamp === lastStamp) return
    lastStamp = stamp
    reload()
  }, pollMs)

  return {
    snapshot: () => current,
    dispose: () => {
      if (timer) clearTimeout(timer)
      clearInterval(poll)
      watcher.close()
    },
  }
}
