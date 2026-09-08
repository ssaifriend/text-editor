import { Show, createEffect, on, onCleanup, onMount } from 'solid-js'
import type { Workspace } from '../../app/workspace'
import type { PaneLeaf } from '../layout/paneTree'

type Props = { readonly ws: Workspace; readonly leaf: () => PaneLeaf; readonly ptyId: () => string }

export const TerminalHost = (props: Props) => {
  let slot!: HTMLDivElement

  const meta = () => props.ws.state.terminals[props.ptyId()]

  const fit = (): void => {
    const entry = props.ws.terminalRegistry.get(props.ptyId())
    if (entry && slot.clientWidth > 0 && slot.clientHeight > 0) entry.fit.fit()
  }

  onMount(() => {
    const observer = new ResizeObserver(fit)
    observer.observe(slot)

    createEffect(
      on(props.ptyId, (id) => {
        const entry = props.ws.terminalRegistry.get(id)
        if (!entry) return
        slot.replaceChildren(entry.element)
        requestAnimationFrame(fit)
      }),
    )

    onCleanup(() => observer.disconnect())
  })

  return (
    <div
      class="terminal-host"
      onFocusIn={() => props.ws.setTerminalFocus(props.leaf().id, true)}
      onFocusOut={() => props.ws.setTerminalFocus(props.leaf().id, false)}
      onMouseDown={() => props.ws.focusPane(props.leaf().id)}
    >
      <div class="terminal-slot" ref={slot} />
      <Show when={meta() && !meta()!.alive}>
        <div class="terminal-exit" data-testid="terminal-exit">
          <span>[exited {meta()!.exitCode}]</span>
          <button data-testid="terminal-restart" onClick={() => void props.ws.restartTerminal(props.ptyId())}>
            Restart
          </button>
        </div>
      </Show>
    </div>
  )
}
