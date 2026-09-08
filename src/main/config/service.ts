import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type ConfigSnapshot, defaultSettings, parseSettingsText } from '@shared/config'
import { type KeymapSnapshot, type UserBinding, parseKeymapText } from '@shared/keymapFile'
import { defaultFileText } from './defaultFile'
import { defaultKeymapText } from './keymapDefaults'

export type Snapshot<T> = { readonly value: T; readonly error: string | null }
export type FileService<T> = { readonly snapshot: () => Snapshot<T>; readonly dispose: () => void }
export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

const debounceMs = 100
const pollMs = 1000

const codeOf = (e: unknown): string | undefined => (e as { code?: string })?.code

const ensureFile = async (path: string, defaultText: string): Promise<void> => {
  try {
    await readFile(path)
  } catch (e) {
    if (codeOf(e) !== 'ENOENT') throw e
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, defaultText, 'utf8')
  }
}

const load = async <T>(path: string, parseText: (text: string) => Parsed<T>, previous: Snapshot<T>): Promise<Snapshot<T>> => {
  try {
    const parsed = parseText(await readFile(path, 'utf8'))
    return parsed.ok ? { value: parsed.value, error: null } : { value: previous.value, error: parsed.message }
  } catch (e) {
    return { value: previous.value, error: e instanceof Error ? e.message : String(e) }
  }
}

export const createJsonFileService = async <T>(
  userData: string,
  fileName: string,
  defaultText: string,
  parseText: (text: string) => Parsed<T>,
  fallback: T,
  onChange: (snapshot: Snapshot<T>) => void,
): Promise<FileService<T>> => {
  const path = join(userData, fileName)
  await ensureFile(path, defaultText)

  let current = await load(path, parseText, { value: fallback, error: null })
  let timer: NodeJS.Timeout | null = null

  const reload = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      current = await load(path, parseText, current)
      onChange(current)
    }, debounceMs)
  }

  const watcher: FSWatcher = watch(userData, (_event, filename) => {
    if (filename === fileName) reload()
  })

  let lastSeen = await stat(path).then((s) => s.mtimeMs, () => 0)
  const poll = setInterval(async () => {
    const mtimeMs = await stat(path).then((s) => s.mtimeMs, () => lastSeen)
    if (mtimeMs === lastSeen) return
    lastSeen = mtimeMs
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

export type ConfigService = { readonly snapshot: () => ConfigSnapshot; readonly dispose: () => void }

export const createConfigService = async (
  userData: string,
  onChange: (snapshot: ConfigSnapshot) => void,
): Promise<ConfigService> => {
  const toSnapshot = (s: Snapshot<typeof defaultSettings>): ConfigSnapshot => ({ settings: s.value, error: s.error })
  const service = await createJsonFileService(
    userData,
    'settings.json',
    defaultFileText,
    (text) => {
      const parsed = parseSettingsText(text)
      return parsed.ok ? { ok: true, value: parsed.settings } : parsed
    },
    defaultSettings,
    (s) => onChange(toSnapshot(s)),
  )
  return { snapshot: () => toSnapshot(service.snapshot()), dispose: service.dispose }
}

export type KeymapService = { readonly snapshot: () => KeymapSnapshot; readonly dispose: () => void }

export const createKeymapService = async (
  userData: string,
  onChange: (snapshot: KeymapSnapshot) => void,
): Promise<KeymapService> => {
  const toSnapshot = (s: Snapshot<UserBinding[]>): KeymapSnapshot => ({ bindings: s.value, error: s.error })
  const service = await createJsonFileService<UserBinding[]>(
    userData,
    'keymap.json',
    defaultKeymapText,
    (text) => {
      const parsed = parseKeymapText(text)
      return parsed.ok ? { ok: true, value: parsed.bindings } : parsed
    },
    [],
    (s) => onChange(toSnapshot(s)),
  )
  return { snapshot: () => toSnapshot(service.snapshot()), dispose: service.dispose }
}
