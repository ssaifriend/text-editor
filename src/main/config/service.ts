import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type ConfigSnapshot, defaultSettings, parseSettingsText } from '@shared/config'
import { defaultFileText } from './defaultFile'

export type ConfigService = { readonly snapshot: () => ConfigSnapshot; readonly dispose: () => void }

const settingsFileName = 'settings.json'
const debounceMs = 100

const codeOf = (e: unknown): string | undefined => (e as { code?: string })?.code

const ensureFile = async (path: string): Promise<void> => {
  try {
    await readFile(path)
  } catch (e) {
    if (codeOf(e) !== 'ENOENT') throw e
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, defaultFileText, 'utf8')
  }
}

const load = async (path: string, previous: ConfigSnapshot): Promise<ConfigSnapshot> => {
  try {
    const parsed = parseSettingsText(await readFile(path, 'utf8'))
    return parsed.ok
      ? { settings: parsed.settings, error: null }
      : { settings: previous.settings, error: parsed.message }
  } catch (e) {
    return { settings: previous.settings, error: e instanceof Error ? e.message : String(e) }
  }
}

export const createConfigService = async (
  userData: string,
  onChange: (snapshot: ConfigSnapshot) => void,
): Promise<ConfigService> => {
  const path = join(userData, settingsFileName)
  await ensureFile(path)

  let current = await load(path, { settings: defaultSettings, error: null })
  let timer: NodeJS.Timeout | null = null

  const reload = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      current = await load(path, current)
      onChange(current)
    }, debounceMs)
  }

  const watcher: FSWatcher = watch(userData, (_event, filename) => {
    if (filename === settingsFileName) reload()
  })

  return {
    snapshot: () => current,
    dispose: () => {
      if (timer) clearTimeout(timer)
      watcher.close()
    },
  }
}
