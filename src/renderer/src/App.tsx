import { createEffect, createMemo, createSignal, on as onSignal, onCleanup, onMount } from 'solid-js'
import { R } from '@mobily/ts-belt'
import { channels } from '@shared/channels'
import { whenContext } from './app/context'
import { registerAppCommands } from './app/registerCommands'
import { createDirtySync } from './app/dirtySync'
import { createSettings } from './app/settings'
import { installSessionSync } from './app/sessionSync'
import { installKeymap } from './app/useKeymap'
import { createWorkspace, type CloseChoice } from './app/workspace'
import { createCommandRegistry } from './commands/registry'
import { invoke, on } from './ipc'
import { applyEditorFont } from './editor/editorConfig'
import { type Binding, compileBindings } from './keymap/bindings'
import { defaultBindings } from './keymap/defaults'
import type { Platform } from './keymap/keys'
import { installTestHooks } from './testHooks'
import { applyTheme } from './theme/apply'
import { registerUserThemes, themeById } from './theme/themes'
import { PaneView } from './ui/layout/PaneView'
import { Sidebar } from './ui/sidebar/Sidebar'
import { Palette, type PaletteMode } from './ui/palette/Palette'
import { StatusBar } from './ui/statusbar/StatusBar'

const platform = (): Platform => (navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'win')

export const App = () => {
  const [paletteMode, setPaletteMode] = createSignal<PaletteMode | null>(null)
  const [paletteText, setPaletteText] = createSignal('')
  const paletteOpen = () => paletteMode() !== null
  const openPalette = (mode: PaletteMode, text = ''): void => {
    setPaletteText(text)
    setPaletteMode(mode)
  }
  const [ready, setReady] = createSignal(false)
  const settingsStore = createSettings()
  const dirtySync = createDirtySync({
    write: (entry) => invoke('dirty.write', entry),
    clear: (id) => invoke('dirty.clear', id),
  })

  const ws = createWorkspace({
    settings: settingsStore.settings,
    dirtySync,
    confirmClose: async (title): Promise<CloseChoice> => {
      const result = await invoke('dialog.confirmClose', { title })
      return R.match(
        result,
        (r) => r.choice,
        () => 'cancel' as const,
      )
    },
  })

  const [userBindings, setUserBindings] = createSignal<readonly Binding[]>([])
  const bindings = createMemo(() => compileBindings([...defaultBindings(platform()), ...userBindings()], platform()))
  const compiledUserBindings = createMemo(() => compileBindings(userBindings(), platform()))

  const context = () => whenContext(ws, { paletteOpen: paletteOpen() })
  const registry = createCommandRegistry(context)
  registerAppCommands(registry, ws, { openPalette, userBindings: compiledUserBindings })

  createEffect(
    onSignal(
      settingsStore.settings,
      (s) => {
        applyEditorFont(s.editor)
        applyTheme(themeById(s.theme))
        ws.applySettings(s)
      },
      { defer: true },
    ),
  )

  createEffect(
    onSignal(
      () => ws.state.projectRoot,
      (root) => {
        if (!root) return
        void invoke('index.build', { root }).then((result) =>
          R.tap(result, ({ files, truncated }) => {
            if (truncated) ws.setStatus(`file index truncated at ${files.toLocaleString()} files — open a narrower folder for Goto Anything`)
          }),
        )
      },
    ),
  )

  onMount(async () => {
    const uninstall = installKeymap(window, bindings, registry, context)
    const offCommand = on('command.run', ({ id, args }) => void registry.run(id, args))
    onCleanup(() => {
      uninstall()
      offCommand()
    })

    requestAnimationFrame(() => window.moru.send(channels.perfFirstPaint, undefined))

    const bootstrap = await invoke('app.bootstrap', undefined)
    const boot = R.getWithDefault(bootstrap, {
      paths: [] as string[],
      projectRoot: null as string | null,
      windowId: 'main',
      session: null,
      test: false,
    })
    if (boot.test) installTestHooks(ws, registry, paletteMode, ready, bindings)

    const userThemes = await invoke('themes.get', undefined)
    R.tap(userThemes, (snapshot) => registerUserThemes(snapshot.themes))
    onCleanup(
      on('themes.changed', (snapshot) => {
        registerUserThemes(snapshot.themes)
        applyTheme(themeById(settingsStore.settings().theme))
        ws.applySettings(settingsStore.settings())
      }),
    )

    await settingsStore.load()
    applyEditorFont(settingsStore.settings().editor)
    applyTheme(themeById(settingsStore.settings().theme))
    onCleanup(settingsStore.subscribe())

    const keymap = await invoke('keymap.get', undefined)
    R.tap(keymap, (snapshot) => setUserBindings(snapshot.bindings))
    onCleanup(on('keymap.changed', (snapshot) => setUserBindings(snapshot.bindings)))

    window.addEventListener('beforeunload', () => void dirtySync.flush())

    ws.setWindowId(boot.windowId)
    await ws.setProjectRoot(boot.session?.projectRoot ?? boot.projectRoot)
    if (boot.session) {
      const listed = await invoke('dirty.list', undefined)
      await ws.restoreSession(boot.session, R.getWithDefault(listed, []))
    } else {
      await ws.restoreDirty()
    }
    for (const path of boot.paths) await ws.openFile(path)
    if (boot.paths.length === 0 && ws.activeLeaf().tabs.length === 0) ws.newUntitled()
    ws.activeView()?.focus()
    installSessionSync(ws, { send: (snapshot) => window.moru.send('session.save', snapshot) })
    setReady(true)
  })

  return (
    <div class="app">
      <div class="app-row">
        <Sidebar ws={ws} />
        <div class="main-column">
          <div class="workspace">
            <PaneView ws={ws} node={ws.tree} />
          </div>
          <StatusBar ws={ws} />
        </div>
      </div>
      <Palette
        open={paletteMode}
        initialText={paletteText}
        onClose={() => {
          setPaletteMode(null)
          ws.activeView()?.focus()
        }}
        registry={registry}
        bindings={bindings}
        platform={platform()}
        ws={ws}
      />
    </div>
  )
}
