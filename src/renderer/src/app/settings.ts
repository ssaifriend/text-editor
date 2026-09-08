import { createSignal, type Accessor } from 'solid-js'
import { R } from '@mobily/ts-belt'
import { type ConfigSnapshot, type Settings, defaultSettings } from '@shared/config'
import { invoke, on } from '../ipc'

export type SettingsStore = {
  readonly settings: Accessor<Settings>
  readonly error: Accessor<string | null>
  readonly load: () => Promise<void>
  readonly subscribe: () => () => void
}

export const createSettings = (): SettingsStore => {
  const [settings, setSettings] = createSignal<Settings>(defaultSettings)
  const [error, setError] = createSignal<string | null>(null)

  const accept = (snapshot: ConfigSnapshot): void => {
    setSettings(snapshot.settings)
    setError(snapshot.error)
  }

  return {
    settings,
    error,
    load: async () => {
      const result = await invoke('config.get', undefined)
      R.tap(result, accept)
    },
    subscribe: () => on('config.changed', accept),
  }
}
