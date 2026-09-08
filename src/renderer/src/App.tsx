import { createSignal, onCleanup, onMount } from 'solid-js'
import { R } from '@mobily/ts-belt'
import { channels } from '@shared/channels'
import { whenContext } from './app/context'
import { registerAppCommands } from './app/registerCommands'
import { installKeymap } from './app/useKeymap'
import { createWorkspace, type CloseChoice } from './app/workspace'
import { createCommandRegistry } from './commands/registry'
import { invoke, on } from './ipc'
import { compileBindings } from './keymap/bindings'
import { defaultBindings } from './keymap/defaults'
import type { Platform } from './keymap/keys'
import { installTestHooks } from './testHooks'
import { PaneView } from './ui/layout/PaneView'
import { CommandPalette } from './ui/palette/CommandPalette'
import { StatusBar } from './ui/statusbar/StatusBar'

const platform = (): Platform => (navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'win')

export const App = () => {
  const [paletteOpen, setPaletteOpen] = createSignal(false)

  const ws = createWorkspace({
    confirmClose: async (title): Promise<CloseChoice> => {
      const result = await invoke('dialog.confirmClose', { title })
      return R.match(
        result,
        (r) => r.choice,
        () => 'cancel' as const,
      )
    },
  })

  const context = () => whenContext(ws, { paletteOpen: paletteOpen() })
  const registry = createCommandRegistry(context)
  registerAppCommands(registry, ws, { openPalette: () => setPaletteOpen(true) })

  const bindings = compileBindings(defaultBindings(platform()), platform())

  onMount(async () => {
    const uninstall = installKeymap(window, () => bindings, registry, context)
    const offCommand = on('command.run', ({ id, args }) => void registry.run(id, args))
    onCleanup(() => {
      uninstall()
      offCommand()
    })

    requestAnimationFrame(() => window.moru.send(channels.perfFirstPaint, undefined))

    const bootstrap = await invoke('app.bootstrap', undefined)
    await R.match(
      bootstrap,
      async ({ paths, test }) => {
        if (test) installTestHooks(ws, registry, paletteOpen)
        for (const path of paths) await ws.openFile(path)
        if (paths.length === 0) ws.newUntitled()
        ws.activeView()?.focus()
      },
      async () => ws.newUntitled(),
    )
  })

  return (
    <div class="app">
      <div class="workspace">
        <PaneView ws={ws} node={ws.tree} />
      </div>
      <StatusBar ws={ws} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => {
          setPaletteOpen(false)
          ws.activeView()?.focus()
        }}
        registry={registry}
        bindings={bindings}
        platform={platform()}
      />
    </div>
  )
}
